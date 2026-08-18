"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  PLATFORMS,
  PLATFORM_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  TEST_TYPES,
  TEST_TYPE_LABELS,
} from "@/lib/constants";
import { testCaseSchema, type TestCaseInput } from "@/lib/validations";
import { ApiError, api, errorMessage } from "@/utils/api-client";
import type { TestCaseWithDetails } from "@/types";

export type ModuleOption = { id: string; name: string };

/** Sentinel select value that switches the Module field to "name a new one". */
const NEW_MODULE = "__new-module__";

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
  testCaseId,
  open,
  onOpenChange,
}: {
  projectId: string;
  modules: ModuleOption[];
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

  const moduleOptions = [
    ...modules,
    ...createdModules.filter((c) => !modules.some((m) => m.id === c.id)),
  ];

  // Read inside the open effect through a ref: a background refresh that adds or
  // reorders modules must not re-run the reset and wipe what has been typed.
  const moduleOptionsRef = useRef(moduleOptions);
  moduleOptionsRef.current = moduleOptions;

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
      tcId: "",
      title: "",
      preconditions: "",
      steps: "",
      expectedResult: "",
      testType: "FUNCTIONAL",
      priority: "MEDIUM",
      platform: "WEB",
    },
  });

  useEffect(() => {
    if (!open) return;

    setNewModuleName("");

    if (!testCaseId) {
      const options = moduleOptionsRef.current;
      reset({
        moduleId: options[0]?.id ?? "",
        tcId: "",
        title: "",
        preconditions: "",
        steps: "",
        expectedResult: "",
        testType: "FUNCTIONAL",
        priority: "MEDIUM",
        platform: "WEB",
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
        reset({
          moduleId: testCase.moduleId,
          tcId: testCase.tcId,
          title: testCase.title,
          preconditions: testCase.preconditions ?? "",
          steps: testCase.steps ?? "",
          expectedResult: testCase.expectedResult ?? "",
          testType: testCase.testType,
          priority: testCase.priority,
          platform: testCase.platform,
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
  const testType = watch("testType");
  const priority = watch("priority");
  const platform = watch("platform");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
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
                <Label htmlFor="tcId">
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
                <Label htmlFor={creatingModule ? "newModuleName" : "moduleId"}>
                  Module <span className="text-destructive">*</span>
                </Label>

                {creatingModule ? (
                  <>
                    <div className="flex items-center gap-2">
                      <Input
                        id="newModuleName"
                        placeholder="Login"
                        value={newModuleName}
                        onChange={(event) => setNewModuleName(event.target.value)}
                        onKeyDown={(event) => {
                          // Enter would otherwise submit the test case form.
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void handleCreateModule();
                          }
                        }}
                        disabled={savingModule}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void handleCreateModule()}
                        disabled={savingModule}
                      >
                        {savingModule ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          "Add"
                        )}
                      </Button>
                      {moduleOptions.length > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setCreatingModule(false);
                            setNewModuleName("");
                          }}
                          disabled={savingModule}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                    {moduleOptions.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        This project has no modules yet — name the first one, e.g.
                        Login or Payment.
                      </p>
                    )}
                  </>
                ) : (
                  <Select
                    value={moduleId ?? ""}
                    onValueChange={(value) => {
                      if (value === NEW_MODULE) {
                        setCreatingModule(true);
                        return;
                      }
                      setValue("moduleId", value, { shouldDirty: true });
                    }}
                  >
                    <SelectTrigger id="moduleId">
                      <SelectValue placeholder="Select a module" />
                    </SelectTrigger>
                    <SelectContent>
                      {moduleOptions.map((mod) => (
                        <SelectItem key={mod.id} value={mod.id}>
                          {mod.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={NEW_MODULE} className="text-primary">
                        + New module…
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}

                {errors.moduleId && (
                  <p className="text-xs text-destructive">
                    {errors.moduleId.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="testType">Test type</Label>
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
                <Label htmlFor="priority">Priority</Label>
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
                <Label htmlFor="platform">Platform</Label>
                <Select
                  value={platform ?? "WEB"}
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
                    {PLATFORMS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {PLATFORM_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
