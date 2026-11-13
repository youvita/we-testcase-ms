"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Globe, KeyRound, Loader2, LogIn, Pencil, Plus, Server, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { runEnvironmentSchema, type RunEnvironmentDto, type RunEnvironmentOutput } from "@wetestcase/dto";
import { api, errorMessage } from "@/utils/api-client";

/**
 * Where runs point. Each environment has a base URL per platform and named
 * variables scripts read as `vars.NAME`; secret ones are write-only here.
 *
 * One is the project's default — listed first and preselected wherever an
 * environment is chosen. The first one added becomes it.
 */
export function EnvironmentsPanel({
  projectId,
  environments,
  canManage,
}: {
  projectId: string;
  environments: RunEnvironmentDto[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<RunEnvironmentDto | "new" | null>(null);
  const [deleting, setDeleting] = useState<RunEnvironmentDto | null>(null);

  async function makeDefault(env: RunEnvironmentDto) {
    try {
      await api.post(`/api/run-environments/${env.id}/default`);
      toast.success(`${env.name} is now the default environment`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  /** Copy it, then open the copy: it needs a new name and usually a new URL. */
  async function duplicate(env: RunEnvironmentDto) {
    try {
      const copy = await api.post<RunEnvironmentDto>(`/api/run-environments/${env.id}/duplicate`);
      toast.success(`Created ${copy.name}`, {
        description: "Rename it and change its URLs and accounts.",
      });
      router.refresh();
      setEditing(copy);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await api.delete(`/api/run-environments/${deleting.id}`);
      toast.success(`Deleted ${deleting.name}`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  return (
    <div className="space-y-4">
      {environments.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No environments yet"
          description="Add the environment your scripts run against — for example SIT with its web and API base URLs and a test account."
          action={
            canManage ? (
              <Button onClick={() => setEditing("new")} data-tour="env-add">
                <Plus className="mr-2 size-4" />
                Add environment
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {canManage && (
            <div className="flex justify-end">
              <Button onClick={() => setEditing("new")} data-tour="env-add">
                <Plus className="mr-2 size-4" />
                Add environment
              </Button>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {environments.map((env) => (
              <Card key={env.id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {env.name}
                    {env.isDefault && <Badge variant="secondary">Default</Badge>}
                  </CardTitle>
                  {canManage && (
                    <div className="flex gap-1">
                      {!env.isDefault && (
                        <Button
                          data-tour="env-default"
                          size="icon"
                          variant="ghost"
                          aria-label={`Make ${env.name} the default`}
                          title="Make default"
                          onClick={() => void makeDefault(env)}
                        >
                          <Star className="size-4" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Duplicate ${env.name}`}
                        title="Duplicate"
                        onClick={() => void duplicate(env)}
                      >
                        <Copy className="size-4" />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={`Edit ${env.name}`} onClick={() => setEditing(env)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete ${env.name}`} onClick={() => setDeleting(env)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p className="flex items-center gap-2">
                    <Globe className="size-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Web</span>
                    <span className="truncate font-mono text-xs">{env.webBaseUrl ?? "—"}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Server className="size-4 text-muted-foreground" />
                    <span className="text-muted-foreground">API</span>
                    <span className="truncate font-mono text-xs">{env.apiBaseUrl ?? "—"}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <LogIn className="size-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Start</span>
                    <span className="truncate font-mono text-xs">{env.startPath ?? "/"}</span>
                  </p>
                  {env.variables.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {env.variables.map((v) => (
                        <Badge
                          key={v.key}
                          variant="outline"
                          className={
                            v.secret && v.empty
                              ? "gap-1 border-destructive font-mono text-destructive"
                              : "gap-1 font-mono"
                          }
                          title={v.secret && v.empty ? `${v.key} has no value — edit to fill it in` : undefined}
                        >
                          {v.secret && <KeyRound className="size-3" />}
                          {v.key}
                          {v.secret && v.empty && <span className="font-sans">· no value</span>}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <EnvironmentDialog
        projectId={projectId}
        environment={editing}
        onClose={() => setEditing(null)}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        description="Past runs keep its name. New runs can no longer use it."
        onConfirm={handleDelete}
      />
    </div>
  );
}

type VariableRow = { key: string; value: string; secret: boolean; stored: boolean };

/**
 * Add or edit one environment. Also used by the project form, which may not
 * have a project yet: given `onDraft`, a new environment is handed back
 * instead of saved, for the project to create along with itself.
 */
export function EnvironmentDialog({
  projectId,
  environment,
  onClose,
  onCreated,
  onDraft,
  suggestedName = "SIT",
}: {
  projectId?: string;
  environment: RunEnvironmentDto | "new" | null;
  onClose: () => void;
  /** Called with the environment just added. */
  onCreated?: (environment: RunEnvironmentDto) => void;
  /** Called instead of saving a new environment. */
  onDraft?: (input: RunEnvironmentOutput) => void;
  suggestedName?: string;
}) {
  const router = useRouter();
  const [openFor, setOpenFor] = useState<RunEnvironmentDto | "new" | null>(null);
  const [name, setName] = useState("");
  const [webBaseUrl, setWebBaseUrl] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [startPath, setStartPath] = useState("");
  const [variables, setVariables] = useState<VariableRow[]>([]);
  const [saving, setSaving] = useState(false);

  // Load the form whenever a different environment is opened.
  if (environment !== openFor) {
    setOpenFor(environment);
    const existing = environment !== "new" ? environment : null;
    setName(existing?.name ?? (environment === "new" ? suggestedName : ""));
    setWebBaseUrl(existing?.webBaseUrl ?? "");
    setApiBaseUrl(existing?.apiBaseUrl ?? "");
    setStartPath(existing?.startPath ?? "");
    setVariables(
      existing?.variables.map((v) => ({
        key: v.key,
        value: v.value ?? "",
        secret: v.secret,
        // A blank secret (e.g. from a copied environment) has nothing to
        // keep: it must be typed in, not left "unchanged".
        stored: !(v.secret && v.empty),
      })) ?? [],
    );
  }

  function update(index: number, patch: Partial<VariableRow>) {
    setVariables((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function handleSave() {
    const blankSecret = variables.find((v) => v.key.trim() && v.secret && !v.stored && v.value === "");
    if (blankSecret) {
      toast.error(`Give ${blankSecret.key.trim().toUpperCase()} a value`);
      return;
    }
    setSaving(true);
    try {
      const body = {
        name,
        webBaseUrl: webBaseUrl || null,
        apiBaseUrl: apiBaseUrl || null,
        startPath: startPath || null,
        variables: variables
          .filter((v) => v.key.trim())
          .map((v) => ({
            key: v.key.trim().toUpperCase(),
            // A stored secret left blank keeps its value.
            value: v.secret && v.stored && v.value === "" ? null : v.value,
            secret: v.secret,
          })),
      };
      if (environment === "new" && onDraft) {
        // Checked here, as the server would: the draft is not sent until the
        // project is, and a mistake found then would be far from its field.
        const parsed = runEnvironmentSchema.safeParse(body);
        if (!parsed.success) {
          toast.error(parsed.error.issues[0]?.message ?? "Check the environment's fields");
          return;
        }
        onDraft(parsed.data);
        onClose();
        return;
      }
      if (environment === "new") {
        const created = await api.post<RunEnvironmentDto>(`/api/projects/${projectId}/run-environments`, body);
        toast.success("Environment added");
        onCreated?.(created);
      } else if (environment) {
        await api.patch(`/api/run-environments/${environment.id}`, body);
        toast.success("Environment saved");
      }
      onClose();
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={environment !== null} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{environment === "new" ? "Add environment" : "Edit environment"}</DialogTitle>
          <DialogDescription>
            Scripts use the base URL for their platform, so{" "}
            <code className="font-mono">page.goto(&quot;/login&quot;)</code> and{" "}
            <code className="font-mono">request.get(&quot;/users&quot;)</code> work in every
            environment.
          </DialogDescription>
        </DialogHeader>

        <div className="-m-1 grid max-h-[65vh] gap-4 overflow-y-auto p-1">
          <div className="space-y-2">
            <Label htmlFor="env-name">Name</Label>
            <Input id="env-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="SIT" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="env-web">Web base URL</Label>
              <Input
                id="env-web"
                value={webBaseUrl}
                onChange={(e) => setWebBaseUrl(e.target.value)}
                placeholder="https://sit.example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="env-api">API base URL</Label>
              <Input
                id="env-api"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                placeholder="https://sit-api.example.com/v1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="env-start">Start page</Label>
            <Input
              id="env-start"
              value={startPath}
              onChange={(e) => setStartPath(e.target.value)}
              placeholder="/kh/login"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Where Web tests usually begin, after the Web base URL — often the login page.
              The AI opens it first when writing scripts or exploring; blank means /.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Variables</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setVariables((rows) => [...rows, { key: "", value: "", secret: false, stored: false }])
                }
              >
                <Plus className="mr-1.5 size-3.5" />
                Add variable
              </Button>
            </div>
            {variables.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Test accounts, IDs, tokens — scripts read them as <code className="font-mono">vars.USER_EMAIL</code>.
              </p>
            ) : (
              <div className="space-y-2">
                {variables.map((row, index) => (
                  <div key={index} className="grid grid-cols-[1fr_1.4fr_auto_auto] items-center gap-2">
                    <Input
                      aria-label="Variable name"
                      className="font-mono text-xs"
                      placeholder="USER_EMAIL"
                      value={row.key}
                      onChange={(e) => update(index, { key: e.target.value.toUpperCase() })}
                    />
                    <Input
                      aria-label="Value"
                      type={row.secret ? "password" : "text"}
                      autoComplete="off"
                      placeholder={
                        row.secret && row.stored
                          ? "•••••• (unchanged)"
                          : row.secret && row.key.trim()
                            ? "No value — enter one"
                            : "value"
                      }
                      className={row.secret && !row.stored && row.value === "" && row.key.trim() ? "border-destructive" : undefined}
                      value={row.value}
                      onChange={(e) => update(index, { value: e.target.value })}
                    />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={row.secret}
                        onCheckedChange={(checked) => update(index, { secret: checked === true })}
                      />
                      Secret
                    </label>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Remove variable"
                      onClick={() => setVariables((rows) => rows.filter((_, i) => i !== index))}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Secret values are encrypted and never shown again; leave one blank to keep it.
                  Scripts can still read them, so use test accounts, not real ones.
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving || !name.trim()} onClick={() => void handleSave()}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
