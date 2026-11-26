"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  PLATFORMS,
  PLATFORM_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  TEST_TYPES,
  TEST_TYPE_LABELS,
  WEB_SITES,
  WEB_SITE_LABELS,
} from "@/lib/constants";
import { testCaseSchema, type TestCaseInput } from "@/lib/validations";
import { ApiError, api, errorMessage } from "@/utils/api-client";
import type { Platform, SubModuleOption, TestCaseWithDetails } from "@/types";


export type ModuleOption = { id: string; name: string };

const SITE_HELP =
  "Which base URL its pages open on, in every environment: the Web base URL or the Admin base URL.";

/** Sentinel select value that switches the Module field to "name a new one". */
const NEW_MODULE = "__new-module__";

/** One choice in the Module field: a module, or a sub-module inside it. */
const SEP = "\u001f";
const placeValue = (moduleId: string, subModule: string) => `${moduleId}${SEP}${subModule}`;

/**
 * Create/edit a single test case.
 *
 * In edit mode the full record is fetched when the dialog opens — the list only
 * carries summary fields, and steps/expected result can be long.
 *
 * A test case must belong to a module, and a freshly created project has none,
 * so the Module field can create one on the spot — otherwise the first test case
 * in a project would be unreachable from here.
 */
export function TestCaseFormDialog({
  projectId,
  modules,
  subModules = [],
  platforms,
  testCaseId,
  open,
  onOpenChange,
}: {
  projectId: string;
  modules: ModuleOption[];
  /** Listed under their modules in the Module field. */
  subModules?: SubModuleOption[];
  /** The project's platforms — the only ones offered. */
  platforms: Platform[];
  /** Omitted for create. */
  testCaseId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const isEdit = Boolean(testCaseId);
  const [loading, setLoading] = useState(false);

  /** Modules added from this dialog, before the page has been refreshed. */
  const [createdModules, setCreatedModules] = useState<ModuleOption[]>([]);
  const [creatingModule, setCreatingModule] = useState(false);
  const [newModuleName, setNewModuleName] = useState("");
  const [savingModule, setSavingModule] = useState(false);
  /** Naming a new sub-module; holds the place to go back to on Cancel. */
  const [namingSub, setNamingSub] = useState<{ moduleId: string; subModule: string } | null>(null);
  const [moduleListOpen, setModuleListOpen] = useState(false);

  const moduleOptions = [
    ...modules,
    ...createdModules.filter((c) => !modules.some((m) => m.id === c.id)),
  ];

  // Read inside the open effect through a ref: a background refresh that adds or
  // reorders modules must not re-run the reset and wipe what has been typed.
  const moduleOptionsRef = useRef(moduleOptions);
  moduleOptionsRef.current = moduleOptions;
  const platformsRef = useRef(platforms);
  platformsRef.current = platforms;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TestCaseInput>({
    resolver: zodResolver(testCaseSchema),
    defaultValues: {
      moduleId: modules[0]?.id ?? "",
      subModule: "",
      tcId: "",
      title: "",
      preconditions: "",
      steps: "",
      expectedResult: "",
      testType: "FUNCTIONAL",
      priority: "MEDIUM",
      platform: platforms[0] ?? "WEB",
      site: "WEB",
    },
  });

  useEffect(() => {
    if (!open) return;

    setNewModuleName("");
    setNamingSub(null);

    if (!testCaseId) {
      const options = moduleOptionsRef.current;
      reset({
        moduleId: options[0]?.id ?? "",
        subModule: "",
        tcId: "",
        title: "",
        preconditions: "",
        steps: "",
        expectedResult: "",
        testType: "FUNCTIONAL",
        priority: "MEDIUM",
        platform: platformsRef.current[0] ?? "WEB",
        site: "WEB",
      });
      // Nothing to pick from yet — go straight to naming the first module.
      setCreatingModule(options.length === 0);
      return;
    }

    setCreatingModule(false);

    let cancelled = false;
    setLoading(true);

    api
      .get<TestCaseWithDetails>(`/api/test-cases/${testCaseId}`)
      .then((testCase) => {
        if (cancelled) return;
        // As stored: its open questions are kept in the Discussion panel, so
        // an older case's "(confirm with PO)" markers stay in its text here
        // rather than being split off into a field this form does not have.
        reset({
          moduleId: testCase.moduleId,
          subModule: testCase.subModule ?? "",
          tcId: testCase.tcId,
          title: testCase.title,
          preconditions: testCase.preconditions ?? "",
          steps: testCase.steps ?? "",
          expectedResult: testCase.expectedResult ?? "",
          testType: testCase.testType,
          priority: testCase.priority,
          platform: testCase.platform,
          site: testCase.site,
        });
      })
      .catch((error) => {
        if (!cancelled) toast.error(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, testCaseId, reset]);

  /**
   * Create the module and select it, without refreshing the page — a refresh
   * mid-form would re-render this dialog's parent while the user is still typing.
   * `handleOpenChange` picks the new module up when the dialog closes.
   */
  async function handleCreateModule() {
    const name = newModuleName.trim();
    if (!name) {
      toast.error("Module name is required");
      return;
    }

    setSavingModule(true);
    try {
      const created = await api.post<ModuleOption>(
        `/api/projects/${projectId}/modules`,
        { name, description: "", position: 0 },
      );

      setCreatedModules((prev) => [...prev, { id: created.id, name: created.name }]);
      setValue("moduleId", created.id, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setValue("subModule", "", { shouldDirty: true });
      setCreatingModule(false);
      setNewModuleName("");
      toast.success(`Module "${created.name}" created`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSavingModule(false);
    }
  }

  /** Closing after adding a module has to refresh, or the list stays stale. */
  function handleOpenChange(next: boolean) {
    if (!next && createdModules.length > 0) router.refresh();
    onOpenChange(next);
  }

  async function onSubmit(values: TestCaseInput) {
    try {
      if (isEdit && testCaseId) {
        await api.patch(`/api/test-cases/${testCaseId}`, values);
        toast.success("Test case updated");
      } else {
        await api.post(`/api/projects/${projectId}/test-cases`, values);
        toast.success("Test case created");
      }

      onOpenChange(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors) {
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
          const message = messages[0];
          if (message) setError(field as keyof TestCaseInput, { message });
        }
      }
      toast.error(errorMessage(error));
    }
  }

  const moduleId = watch("moduleId");
  const subModule = watch("subModule");
  const currentModule = moduleOptions.find((mod) => mod.id === moduleId);
  /** Name a new sub-module in that module, from the "+" beside it. */
  function startSubModule(id: string) {
    setModuleListOpen(false);
    setNamingSub({ moduleId: moduleId ?? "", subModule: subModule ?? "" });
    setValue("moduleId", id, { shouldDirty: true, shouldValidate: true });
    setValue("subModule", "", { shouldDirty: true });
  }

  /** Done naming it; left blank, the earlier choice comes back. */
  function finishSubModule() {
    if (namingSub && !subModule?.trim()) {
      setValue("moduleId", namingSub.moduleId);
      setValue("subModule", namingSub.subModule);
    }
    setNamingSub(null);
  }

  /** Back to what was chosen before the sub-module box opened. */
  function cancelSubModule() {
    if (namingSub) {
      setValue("moduleId", namingSub.moduleId, { shouldDirty: true });
      setValue("subModule", namingSub.subModule, { shouldDirty: true });
    }
    setNamingSub(null);
  }

  /** Back to the module list, without adding one. */
  function cancelNewModule() {
    setCreatingModule(false);
    setNewModuleName("");
  }

  const moduleHelp = creatingModule
    ? moduleOptions.length === 0
      ? "This project has no modules yet. Type the first one's name, e.g. Login or Payment, and press Enter to add it."
      : "Type the new module's name and press Enter to add it. × or Esc cancels."
    : namingSub
      ? `Type the new sub-module's name and press Enter to add it to ${currentModule?.name ?? "the module"}. × or Esc cancels.`
      : "The module this case belongs to, or a sub-module inside it. Use + beside a module to add a sub-module.";

  /** A module's sub-modules, with the one being typed for this case. */
  const subModuleNames = (id: string) => {
    const names = subModules.filter((sub) => sub.moduleId === id).map((sub) => sub.name);
    const typed = subModule?.trim();
    return id === moduleId && typed && !names.includes(typed) ? [...names, typed] : names;
  };
  const testType = watch("testType");
  const priority = watch("priority");
  const platform = watch("platform");
  const site = watch("site");
  // A case being edited keeps its own platform as an option even if the
  // project no longer lists it, so opening the form cannot silently change it.
  const platformOptions = PLATFORMS.filter(
    (option) => platforms.includes(option) || option === platform,
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        onEscapeKeyDown={(event) => {
          // Esc while naming a module or sub-module cancels that, not the whole form.
          if (namingSub) {
            event.preventDefault();
            cancelSubModule();
          } else if (creatingModule && moduleOptions.length > 0) {
            event.preventDefault();
            if (!savingModule) cancelNewModule();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit test case" : "New test case"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Editing the case does not change any recorded result."
              : "TC IDs must be unique within the project."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <form
            id="test-case-form"
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="block h-5 leading-5" htmlFor="tcId">
                  TC ID <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="tcId"
                  placeholder="TC-LOGIN-001"
                  className="font-mono"
                  aria-invalid={Boolean(errors.tcId)}
                  {...register("tcId")}
                />
                {errors.tcId && (
                  <p className="text-xs text-destructive">
                    {errors.tcId.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex h-5 items-center gap-1.5">
                  <Label
                    htmlFor={creatingModule ? "newModuleName" : namingSub ? "newSubModule" : "moduleId"}
                  >
                    Module <span className="text-destructive">*</span>
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={moduleHelp}
                      >
                        <Info className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-64">{moduleHelp}</TooltipContent>
                  </Tooltip>
                </div>

                {creatingModule ? (
                  <div className="relative">
                    <Input
                      id="newModuleName"
                      placeholder={
                        moduleOptions.length === 0 ? "Name the first module, e.g. Login" : "New module, e.g. Login"
                      }
                      maxLength={120}
                      autoComplete="off"
                      // Opened from the list: straight to typing. A project with no
                      // modules starts here, and the TC ID keeps the focus.
                      autoFocus={moduleOptions.length > 0}
                      className="pr-9"
                      value={newModuleName}
                      // Read-only rather than disabled while saving, so it keeps the focus.
                      readOnly={savingModule}
                      onChange={(event) => setNewModuleName(event.target.value)}
                      onKeyDown={(event) => {
                        // Enter adds it, rather than submitting the form.
                        if (event.key === "Enter") {
                          event.preventDefault();
                          if (!savingModule) void handleCreateModule();
                        }
                      }}
                    />
                    {savingModule ? (
                      <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    ) : (
                      moduleOptions.length > 0 && (
                        <button
                          type="button"
                          aria-label="Cancel the new module"
                          title="Cancel"
                          className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                          onClick={cancelNewModule}
                        >
                          <X className="size-4" />
                        </button>
                      )
                    )}
                  </div>
                ) : namingSub !== null ? (
                  <div className="relative">
                    <Input
                      id="newSubModule"
                      placeholder={`New sub-module in ${currentModule?.name ?? "this module"}`}
                      maxLength={120}
                      autoComplete="off"
                      autoFocus
                      className="pr-9"
                      value={subModule ?? ""}
                      aria-invalid={Boolean(errors.subModule)}
                      onChange={(event) =>
                        setValue("subModule", event.target.value, { shouldDirty: true })
                      }
                      onKeyDown={(event) => {
                        // Enter adds it, rather than submitting the form.
                        if (event.key === "Enter") {
                          event.preventDefault();
                          finishSubModule();
                        }
                      }}
                    />
                    <button
                      type="button"
                      aria-label="Cancel the new sub-module"
                      title="Cancel"
                      className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={cancelSubModule}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <Select
                    open={moduleListOpen}
                    onOpenChange={setModuleListOpen}
                    value={moduleId ? placeValue(moduleId, subModule?.trim() ?? "") : ""}
                    onValueChange={(value) => {
                      if (value === NEW_MODULE) {
                        setCreatingModule(true);
                        return;
                      }
                      const [nextModule = "", nextSub = ""] = value.split(SEP);
                      setValue("moduleId", nextModule, { shouldDirty: true, shouldValidate: true });
                      setValue("subModule", nextSub, { shouldDirty: true });
                    }}
                  >
                    <SelectTrigger id="moduleId">
                      <SelectValue placeholder="Select a module" />
                    </SelectTrigger>
                    <SelectContent>
                      {moduleOptions.map((mod) => (
                        <SelectGroup key={mod.id}>
                          <div className="flex items-center gap-1">
                            <SelectItem value={placeValue(mod.id, "")} className="flex-1 font-medium">
                              {mod.name}
                            </SelectItem>
                            {/* Beside the item, not in it: an item's text is copied into the field. */}
                            <button
                              type="button"
                              aria-label={`Add a sub-module to ${mod.name}`}
                              title={`Add a sub-module to ${mod.name}`}
                              className="mr-1 grid size-7 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => startSubModule(mod.id)}
                            >
                              <Plus className="size-4" />
                            </button>
                          </div>
                          {subModuleNames(mod.id).map((name) => (
                            <SelectItem key={name} value={placeValue(mod.id, name)} className="pl-6">
                              <span className="text-muted-foreground">{mod.name} › </span>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                      <SelectSeparator />
                      <SelectItem value={NEW_MODULE} className="text-primary">
                        + New module…
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}

                {(errors.moduleId || errors.subModule) && (
                  <p className="text-xs text-destructive">
                    {errors.moduleId?.message ?? errors.subModule?.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="block h-5 leading-5" htmlFor="testType">Test type</Label>
                <Select
                  value={testType ?? "FUNCTIONAL"}
                  onValueChange={(value) =>
                    setValue("testType", value as TestCaseInput["testType"], {
                      shouldDirty: true,
                    })
                  }
                >
                  <SelectTrigger id="testType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEST_TYPES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {TEST_TYPE_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="block h-5 leading-5" htmlFor="priority">Priority</Label>
                <Select
                  value={priority ?? "MEDIUM"}
                  onValueChange={(value) =>
                    setValue("priority", value as TestCaseInput["priority"], {
                      shouldDirty: true,
                    })
                  }
                >
                  <SelectTrigger id="priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {PRIORITY_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="block h-5 leading-5" htmlFor="platform">Platform</Label>
                <Select
                  value={platform ?? platforms[0] ?? "WEB"}
                  onValueChange={(value) =>
                    setValue("platform", value as TestCaseInput["platform"], {
                      shouldDirty: true,
                    })
                  }
                >
                  <SelectTrigger id="platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {platformOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {PLATFORM_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {(platform ?? platforms[0]) === "WEB" && (
                <div className="space-y-2">
                  <div className="flex h-5 items-center gap-1.5">
                    <Label htmlFor="site">Site</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={SITE_HELP}
                        >
                          <Info className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-64">{SITE_HELP}</TooltipContent>
                    </Tooltip>
                  </div>
                  <Select
                    value={site ?? "WEB"}
                    onValueChange={(value) =>
                      setValue("site", value as TestCaseInput["site"], {
                        shouldDirty: true,
                      })
                    }
                  >
                    <SelectTrigger id="site">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEB_SITES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {WEB_SITE_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">
                Test case <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                placeholder="Sign in with valid credentials"
                aria-invalid={Boolean(errors.title)}
                {...register("title")}
              />
              {errors.title && (
                <p className="text-xs text-destructive">
                  {errors.title.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="preconditions">Preconditions</Label>
              <Textarea
                id="preconditions"
                rows={2}
                placeholder="An active user account exists."
                {...register("preconditions")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="steps">Steps</Label>
              <Textarea
                id="steps"
                rows={5}
                className="font-mono text-sm"
                placeholder={"1. Open the login page\n2. Enter credentials\n3. Submit"}
                {...register("steps")}
              />
              <p className="text-xs text-muted-foreground">
                Line breaks are preserved.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="expectedResult">Expected result</Label>
              <Textarea
                id="expectedResult"
                rows={3}
                placeholder="The user reaches the dashboard."
                {...register("expectedResult")}
              />
            </div>
          </form>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="test-case-form"
            disabled={isSubmitting || loading || savingModule}
          >
            {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            {isEdit ? "Save changes" : "Create test case"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
