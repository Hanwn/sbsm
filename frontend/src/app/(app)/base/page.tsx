"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-client";

type BaseConfig = {
  id: string;
  name: string;
  description: string | null;
  selector_tags: string[];
  selector_rules: { outbound: string; nodes: string }[];
  version: "1.12" | "1.13" | "1.14" | null;
  config: unknown;
  created_at: number;
  updated_at: number;
};

type AlertState =
  | { type: "success"; title: string; message: string }
  | { type: "error"; title: string; message: string }
  | null;

const EMPTY_TEMPLATE = JSON.stringify(
  {
    log: {},
    dns: {},
    ntp: {},
    certificate: {},
    endpoints: [],
    inbounds: [],
    outbounds: [],
    route: {},
    services: [],
    experimental: {},
  },
  null,
  2
);

export default function BaseConfigsPage() {
  const [configs, setConfigs] = useState<BaseConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<AlertState>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createVersion, setCreateVersion] = useState<"1.12" | "1.13" | "1.14">("1.12");
  const [createConfigJson, setCreateConfigJson] = useState(EMPTY_TEMPLATE);
  const [createFileError, setCreateFileError] = useState("");
  const [createRules, setCreateRules] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const [editTarget, setEditTarget] = useState<BaseConfig | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editVersion, setEditVersion] = useState<"1.12" | "1.13" | "1.14" | "unspecified">("unspecified");
  const [editConfigJson, setEditConfigJson] = useState(EMPTY_TEMPLATE);
  const [editFileError, setEditFileError] = useState("");
  const [editRules, setEditRules] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BaseConfig | null>(null);

  const sortedConfigs = useMemo(
    () => [...configs].sort((a, b) => b.updated_at - a.updated_at),
    [configs]
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setAlert(null);
      try {
        const data = await apiFetch<BaseConfig[]>("/api/base-configs");
        if (!cancelled) {
          setConfigs(data);
        }
      } catch (error) {
        console.error("Failed to load base configs", error);
        if (!cancelled) {
          setAlert({
            type: "error",
            title: "Failed to load base configs",
            message: error instanceof Error ? error.message : "Unexpected error loading base configs.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function resetCreateForm() {
    setCreateName("");
    setCreateDescription("");
    setCreateVersion("1.12");
    setCreateConfigJson(EMPTY_TEMPLATE);
    setCreateFileError("");
    setCreateRules({});
  }

  function openEditDialog(config: BaseConfig) {
    setEditTarget(config);
    setEditName(config.name);
    setEditDescription(config.description ?? "");
    setEditVersion(config.version ?? "unspecified");
    setEditConfigJson(JSON.stringify(config.config, null, 2));
    setEditFileError("");
    const selected = Object.fromEntries(config.selector_tags.map((tag) => [tag, ".*"]));
    for (const rule of config.selector_rules) {
      try {
        for (const tag of selectorOptions(JSON.stringify(config.config))) {
          if (new RegExp(rule.outbound, "i").test(tag)) selected[tag] = rule.nodes;
        }
      } catch {
        // Invalid rules remain visible in the stored template until it is saved.
      }
    }
    setEditRules(selected);
  }

  function parseRules(input: Record<string, string>): { outbound: string; nodes: string }[] {
    return Object.entries(input).map(([outbound, nodes]) => {
      new RegExp(nodes);
      return { outbound: `^${outbound.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, nodes };
    });
  }

  function selectorOptions(json: string): string[] {
    try {
      const config = JSON.parse(json) as { outbounds?: { type?: string; tag?: string; outbounds?: unknown[] }[] };
      return [...new Set((config.outbounds ?? [])
        .filter((outbound) => outbound && (outbound.type === "selector" || outbound.type === "urltest") && typeof outbound.tag === "string" && (!Array.isArray(outbound.outbounds) || outbound.outbounds.length === 0))
        .map((outbound) => outbound.tag as string))];
    } catch {
      return [];
    }
  }

  function toggleRule(current: Record<string, string>, tag: string): Record<string, string> {
    const next = { ...current };
    if (tag in next) delete next[tag];
    else next[tag] = ".*";
    return next;
  }

  async function loadConfigFile(
    file: File,
    setJson: (value: string) => void,
    setError: (value: string) => void,
  ): Promise<void> {
    try {
      const content = (await file.text()).replace(/^\uFEFF/, "");
      const parsed: unknown = JSON.parse(content);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("The file must contain a JSON object.");
      }
      setJson(JSON.stringify(parsed, null, 2));
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not read the JSON file.");
    }
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createName.trim()) {
      setAlert({
        type: "error",
        title: "Missing name",
        message: "Please provide a base config name.",
      });
      return;
    }
    setSubmitting(true);
    try {
      const parsed = JSON.parse(createConfigJson);
      const payload = {
        name: createName.trim(),
        description: createDescription.trim() || undefined,
        version: createVersion,
        selectorRules: parseRules(Object.fromEntries(Object.entries(createRules).filter(([tag]) => selectorOptions(createConfigJson).includes(tag)))),
        configJson: parsed,
      };
      const created = await apiFetch<BaseConfig>("/api/base-configs", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setConfigs((prev) => [created, ...prev]);
      setAlert({
        type: "success",
        title: "Base config created",
        message: "Sing-box template saved successfully.",
      });
      resetCreateForm();
      setCreateDialogOpen(false);
    } catch (error) {
      console.error("Failed to create base config", error);
      if (error instanceof SyntaxError) {
        setAlert({
          type: "error",
          title: "Invalid template or filter",
          message: error.message,
        });
      } else {
        setAlert({
          type: "error",
          title: "Failed to create base config",
          message:
            error instanceof Error ? error.message : "Unexpected error while creating the base configuration.",
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editTarget) return;
    if (!editName.trim()) {
      setAlert({
        type: "error",
        title: "Missing name",
        message: "Please provide a base config name.",
      });
      return;
    }
    setEditing(true);
    try {
      const parsed = JSON.parse(editConfigJson);
      const payload = {
        name: editName.trim(),
        description: editDescription.trim(),
        version: editVersion === "unspecified" ? null : editVersion,
        selectorRules: parseRules(Object.fromEntries(Object.entries(editRules).filter(([tag]) => selectorOptions(editConfigJson).includes(tag)))),
        selectorTags: [],
        configJson: parsed,
      };
      const updated = await apiFetch<BaseConfig>(`/api/base-configs/${editTarget.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setConfigs((prev) => prev.map((config) => (config.id === updated.id ? updated : config)));
      setAlert({
        type: "success",
        title: "Base config updated",
        message: "Changes saved successfully.",
      });
      setEditTarget(null);
    } catch (error) {
      console.error("Failed to update base config", error);
      if (error instanceof SyntaxError) {
        setAlert({
          type: "error",
          title: "Invalid template or filter",
          message: error.message,
        });
      } else {
        setAlert({
          type: "error",
          title: "Failed to update base config",
          message: error instanceof Error ? error.message : "Unexpected error updating the base configuration.",
        });
      }
    } finally {
      setEditing(false);
    }
  }

  async function handleDeleteConfig() {
    if (!deleteTarget) return;
    const deletedId = deleteTarget.id;
    try {
      await apiFetch(`/api/base-configs/${deletedId}`, {
        method: "DELETE",
      });
      setConfigs((prev) => prev.filter((config) => config.id !== deletedId));
      setAlert({
        type: "success",
        title: "Base config deleted",
        message: "Template removed successfully.",
      });
    } catch (error) {
      console.error("Failed to delete base config", error);
      setAlert({
        type: "error",
        title: "Failed to delete base config",
        message:
          error instanceof Error
            ? error.message
            : "Unexpected error deleting the base configuration.",
      });
    } finally {
      setDeleteTarget(null);
      setEditTarget((prev) => (prev?.id === deletedId ? null : prev));
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-16 items-center gap-2 border-b bg-background px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-5" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Base Configs</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex items-center gap-2">
          <Dialog
            open={createDialogOpen}
            onOpenChange={(open) => {
              setCreateDialogOpen(open);
              if (!open) resetCreateForm();
            }}
          >
            <DialogTrigger asChild>
              <Button>Create base config</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>New sing-box template</DialogTitle>
                <DialogDescription>Choose the target sing-box version and selector rules. The template JSON is used as provided.</DialogDescription>
              </DialogHeader>
              <form className="flex flex-col gap-4" onSubmit={handleCreate}>
                <div className="grid gap-2">
                  <Label htmlFor="base-name">Name</Label>
                  <Input
                    id="base-name"
                    placeholder="Global sing-box template"
                    value={createName}
                    onChange={(event) => setCreateName(event.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Sing-box version</Label>
                  <Select value={createVersion} onValueChange={(value) => setCreateVersion(value as "1.12" | "1.13" | "1.14")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1.12">1.12</SelectItem>
                      <SelectItem value="1.13">1.13</SelectItem>
                      <SelectItem value="1.14">1.14</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="base-description">Description</Label>
                  <Textarea
                    id="base-description"
                    placeholder="Optional notes."
                    value={createDescription}
                    onChange={(event) => setCreateDescription(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Selector groups</Label>
                  <div className="max-h-36 space-y-1 overflow-y-auto">
                    {selectorOptions(createConfigJson).map((tag) => (
                      <div key={tag} className="flex items-center gap-2">
                        <Checkbox checked={tag in createRules} onCheckedChange={() => setCreateRules((current) => toggleRule(current, tag))} />
                        <span className="min-w-32 text-sm">{tag}</span>
                        <Input aria-label={`Node filter for ${tag}`} className={`h-7 min-w-0 flex-1 font-mono text-xs ${tag in createRules ? "" : "invisible"}`} value={createRules[tag] ?? ""}
                          onChange={(event) => setCreateRules((current) => ({ ...current, [tag]: event.target.value }))}
                          placeholder="Node name regex, e.g. 香港|HK|🇭🇰" disabled={!(tag in createRules)} />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Only groups with empty outbounds can be selected. Use .* for all nodes; filters ignore case.</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="base-config-json">Config JSON</Label>
                  <Textarea
                    id="base-config-json"
                    value={createConfigJson}
                    onChange={(event) => {
                      setCreateConfigJson(event.target.value);
                      setCreateFileError("");
                    }}
                    className="h-56 resize-y font-mono text-xs"
                  />
                  <Label htmlFor="base-config-file">Or upload a JSON file</Label>
                  <Input id="base-config-file" type="file" accept=".json,application/json"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void loadConfigFile(file, setCreateConfigJson, setCreateFileError);
                    }} />
                  {createFileError && <p role="alert" className="text-xs text-destructive">{createFileError}</p>}
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Saving…" : "Save template"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </header>
      <main className="flex-1 space-y-6 p-4">
        {alert && (
          <Alert variant={alert.type === "error" ? "destructive" : "default"}>
            <AlertTitle>{alert.title}</AlertTitle>
            <AlertDescription>{alert.message}</AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Sing-box templates</CardTitle>
            {loading ? <span className="text-sm text-muted-foreground">Loading…</span> : null}
          </CardHeader>
          <CardContent>
            {sortedConfigs.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
                {loading
                  ? "Fetching base configs from the worker…"
                  : "No base configs yet. Import one to start generating profiles."}
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Selector groups</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedConfigs.map((config) => (
                      <TableRow key={config.id}>
                        <TableCell className="font-medium">{config.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{config.version ? `sing-box ${config.version}` : "Unspecified"}</TableCell>
                        <TableCell className="max-w-[320px] text-xs text-muted-foreground">
                          {config.selector_rules.length > 0 ? config.selector_rules.map((rule) => rule.outbound).join(", ") : config.selector_tags.length > 0 ? config.selector_tags.join(", ") : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(config.updated_at * 1000).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEditDialog(config)}>
                              Edit
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(config)}>
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mt-4 text-sm text-muted-foreground">
                  Base configs act as templates for rendered sing-box profiles.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null);
            setEditing(false);
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit base config</DialogTitle>
            <DialogDescription>Set the target sing-box version and selector rules. The template JSON is used as provided.</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={handleUpdate}>
            <div className="grid gap-2">
              <Label htmlFor="edit-base-name">Name</Label>
              <Input
                id="edit-base-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>Sing-box version</Label>
              <Select value={editVersion} onValueChange={(value) => setEditVersion(value as "1.12" | "1.13" | "1.14" | "unspecified")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unspecified">Unspecified</SelectItem>
                  <SelectItem value="1.12">1.12</SelectItem>
                  <SelectItem value="1.13">1.13</SelectItem>
                  <SelectItem value="1.14">1.14</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-base-description">Description</Label>
              <Textarea
                id="edit-base-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Selector groups</Label>
              <div className="max-h-36 space-y-1 overflow-y-auto">
                {selectorOptions(editConfigJson).map((tag) => (
                  <div key={tag} className="flex items-center gap-2">
                    <Checkbox checked={tag in editRules} onCheckedChange={() => setEditRules((current) => toggleRule(current, tag))} />
                    <span className="min-w-32 text-sm">{tag}</span>
                    <Input aria-label={`Node filter for ${tag}`} className={`h-7 min-w-0 flex-1 font-mono text-xs ${tag in editRules ? "" : "invisible"}`} value={editRules[tag] ?? ""}
                      onChange={(event) => setEditRules((current) => ({ ...current, [tag]: event.target.value }))}
                      placeholder="Node name regex, e.g. 香港|HK|🇭🇰" disabled={!(tag in editRules)} />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Only groups with empty outbounds can be selected. Use .* for all nodes; filters ignore case.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-base-json">Config JSON</Label>
              <Textarea
                id="edit-base-json"
                value={editConfigJson}
                onChange={(event) => {
                  setEditConfigJson(event.target.value);
                  setEditFileError("");
                }}
                className="h-56 resize-y font-mono text-xs"
              />
              <Label htmlFor="edit-base-file">Or upload a JSON file</Label>
              <Input id="edit-base-file" type="file" accept=".json,application/json"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void loadConfigFile(file, setEditConfigJson, setEditFileError);
                }} />
              {editFileError && <p role="alert" className="text-xs text-destructive">{editFileError}</p>}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditTarget(null);
                  setEditing(false);
                  setDeleteTarget(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={editing}>
                {editing ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the template. Templates used by rendered configs cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDeleteConfig()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
