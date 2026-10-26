"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, KeyRound, Loader2, LogIn, Pencil, Plus, Server, Trash2, X } from "lucide-react";
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
import type { RunEnvironmentDto } from "@wetestcase/dto";
import { api, errorMessage } from "@/utils/api-client";

/**
 * Where runs point. Each environment has a base URL per platform and named
 * variables scripts read as `vars.NAME`; secret ones are write-only here.
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
              <Button onClick={() => setEditing("new")}>
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
              <Button onClick={() => setEditing("new")}>
                <Plus className="mr-2 size-4" />
                Add environment
              </Button>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {environments.map((env) => (
              <Card key={env.id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="text-base">{env.name}</CardTitle>
                  {canManage && (
                    <div className="flex gap-1">
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
                        <Badge key={v.key} variant="outline" className="gap-1 font-mono">
                          {v.secret && <KeyRound className="size-3" />}
                          {v.key}
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

function EnvironmentDialog({
  projectId,
  environment,
  onClose,
}: {
  projectId: string;
  environment: RunEnvironmentDto | "new" | null;
  onClose: () => void;
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
    setName(existing?.name ?? (environment === "new" ? "SIT" : ""));
    setWebBaseUrl(existing?.webBaseUrl ?? "");
    setApiBaseUrl(existing?.apiBaseUrl ?? "");
    setStartPath(existing?.startPath ?? "");
    setVariables(
      existing?.variables.map((v) => ({
        key: v.key,
        value: v.value ?? "",
        secret: v.secret,
        stored: true,
      })) ?? [],
    );
  }

  function update(index: number, patch: Partial<VariableRow>) {
    setVariables((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function handleSave() {
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
      if (environment === "new") {
        await api.post(`/api/projects/${projectId}/run-environments`, body);
        toast.success("Environment added");
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
                      placeholder={row.secret && row.stored ? "•••••• (unchanged)" : "value"}
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
