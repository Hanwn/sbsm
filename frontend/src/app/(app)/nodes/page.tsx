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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/api-client";
import { getLinkProtocolLabel } from "@/lib/link-protocol";

type VpnLink = {
  id: string;
  name: string | null;
  raw_link: string;
  tag: string | null;
  created_at: number;
  updated_at: number;
};

type AlertState =
  | { type: "success"; title: string; message: string }
  | { type: "error"; title: string; message: string }
  | null;

export default function NodesPage() {
  const [nodes, setNodes] = useState<VpnLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<AlertState>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [tag, setTag] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editTarget, setEditTarget] = useState<VpnLink | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editTag, setEditTag] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => b.created_at - a.created_at),
    [nodes],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadNodes() {
      setLoading(true);
      setAlert(null);
      try {
        const data = await apiFetch<VpnLink[]>("/api/links");
        if (!cancelled) setNodes(data);
      } catch (error) {
        console.error("Failed to load VPN nodes", error);
        if (!cancelled) {
          setAlert({
            type: "error",
            title: "Failed to load VPN nodes",
            message:
              error instanceof Error
                ? error.message
                : "Unexpected error loading node list.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadNodes();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim()) {
      setAlert({
        type: "error",
        title: "Missing VPN link",
        message: "Please provide a VPN node link.",
      });
      return;
    }
    setSubmitting(true);
    try {
      const trimmedUrl = url.trim();
      const trimmedName = name.trim();
      const payload = {
        url: trimmedUrl,
        name: trimmedName,
        tag: tag.trim() || null,
      };
      const created = await apiFetch<VpnLink>("/api/links", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setNodes((prev) => [created, ...prev]);
      setAlert({
        type: "success",
        title: "VPN node saved",
        message: "The VPN node link was stored successfully.",
      });
      setName("");
      setUrl("");
      setTag("");
      setCreateDialogOpen(false);
    } catch (error) {
      console.error("Failed to create VPN node", error);
      setAlert({
        type: "error",
        title: "Failed to save node",
        message:
          error instanceof Error
            ? error.message
            : "Unexpected error saving the node.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function openEditDialog(node: VpnLink) {
    setEditTarget(node);
    setEditName(node.name ?? "");
    setEditUrl(node.raw_link);
    setEditTag(node.tag ?? "");
  }

  async function handleUpdateNode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editTarget) return;
    if (!editUrl.trim()) {
      setAlert({
        type: "error",
        title: "Missing VPN link",
        message: "Please provide a VPN node link.",
      });
      return;
    }
    setEditSubmitting(true);
    try {
      const trimmedUrl = editUrl.trim();
      const trimmedName = editName.trim();
      const payload = {
        url: trimmedUrl,
        name: trimmedName,
        tag: editTag.trim() || null,
      };
      const updated = await apiFetch<VpnLink>(`/api/links/${editTarget.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setNodes((prev) =>
        prev.map((node) => (node.id === updated.id ? updated : node)),
      );
      setAlert({
        type: "success",
        title: "VPN node updated",
        message: "The VPN node link was updated.",
      });
      setEditTarget(null);
    } catch (error) {
      console.error("Failed to update VPN node", error);
      setAlert({
        type: "error",
        title: "Failed to update node",
        message:
          error instanceof Error
            ? error.message
            : "Unexpected error updating the node.",
      });
    } finally {
      setEditSubmitting(false);
    }
  }

  async function confirmDelete(id: string) {
    setDeletingId(id);
    try {
      await apiFetch(`/api/links/${id}`, {
        method: "DELETE",
        parseJson: true,
      });
      setNodes((prev) => prev.filter((node) => node.id !== id));
      setEditTarget((prev) => (prev?.id === id ? null : prev));
      setAlert({
        type: "success",
        title: "VPN node removed",
        message: "The VPN node link was deleted.",
      });
    } catch (error) {
      console.error("Failed to delete VPN node", error);
      setAlert({
        type: "error",
        title: "Failed to delete node",
        message:
          error instanceof Error
            ? error.message
            : "Unexpected error deleting the node.",
      });
    } finally {
      setDeletingId(null);
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
              <BreadcrumbPage>VPN Nodes</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex items-center gap-2">
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>Create node</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add VPN node</DialogTitle>
                <DialogDescription>
                  Save a VPN node link that can be reused across configs and
                  groups.
                </DialogDescription>
              </DialogHeader>
              <form className="flex flex-col gap-4" onSubmit={handleCreate}>
                <div className="grid gap-2">
                  <Label htmlFor="node-name">Display name</Label>
                  <Input
                    id="node-name"
                    placeholder="us-west | vless-test"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="node-url">VPN link</Label>
                  <Input
                    id="node-url"
                    placeholder="tuic://..., hy2://..., anytls://..."
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Supported: VLESS, VMess, Trojan, Shadowsocks, TUIC,
                    Hysteria2, AnyTLS.
                  </p>
                  {url.trim() && (
                    <p className="text-xs text-muted-foreground">
                      Detected protocol: {getLinkProtocolLabel(url)}
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="node-tag">Tag</Label>
                  <Input
                    id="node-tag"
                    value={tag}
                    onChange={(event) => setTag(event.target.value)}
                    maxLength={64}
                    placeholder="US nodes"
                  />
                  <p className="text-xs text-muted-foreground">
                    Groups selecting this tag will include this node
                    automatically.
                  </p>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCreateDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Saving…" : "Save node"}
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
            <CardTitle className="text-lg">Stored VPN nodes</CardTitle>
            {loading ? (
              <span className="text-sm text-muted-foreground">Loading…</span>
            ) : null}
          </CardHeader>
          <CardContent>
            {sortedNodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
                {loading
                  ? "Fetching nodes from the worker…"
                  : "No VPN nodes yet. Create one to get started."}
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Protocol</TableHead>
                      <TableHead>Tag</TableHead>
                      <TableHead>VPN link</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedNodes.map((node) => (
                      <TableRow key={node.id}>
                        <TableCell className="font-medium">
                          {node.name?.length ? node.name : "Unnamed node"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {getLinkProtocolLabel(node.raw_link)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {node.tag || "—"}
                        </TableCell>
                        <TableCell className="max-w-[420px]">
                          <span className="block truncate text-xs text-muted-foreground">
                            {node.raw_link}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(node.created_at * 1000).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEditDialog(node)}
                            >
                              Edit
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm">
                                  Delete
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Delete VPN node
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This removes{" "}
                                    <strong>
                                      {node.name?.length
                                        ? node.name
                                        : "this VPN node"}
                                    </strong>{" "}
                                    from the worker and any groups referencing
                                    it. Continue?
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => confirmDelete(node.id)}
                                    disabled={deletingId === node.id}
                                  >
                                    {deletingId === node.id
                                      ? "Deleting…"
                                      : "Delete"}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mt-4 text-sm text-muted-foreground">
                  Nodes are stored in Cloudflare D1 and reused across configs.
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
            setEditSubmitting(false);
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit VPN node</DialogTitle>
            <DialogDescription>
              Update the VPN link or rename this node.
            </DialogDescription>
          </DialogHeader>
          {editTarget && (
            <form className="flex flex-col gap-4" onSubmit={handleUpdateNode}>
              <div className="grid gap-2">
                <Label htmlFor="edit-node-name">Display name</Label>
                <Input
                  id="edit-node-name"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  placeholder="Optional label"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-node-url">VPN link</Label>
                <Input
                  id="edit-node-url"
                  value={editUrl}
                  onChange={(event) => setEditUrl(event.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Supported: VLESS, VMess, Trojan, Shadowsocks, TUIC, Hysteria2,
                  AnyTLS.
                </p>
                {editUrl.trim() && (
                  <p className="text-xs text-muted-foreground">
                    Detected protocol: {getLinkProtocolLabel(editUrl)}
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-node-tag">Tag</Label>
                <Input
                  id="edit-node-tag"
                  value={editTag}
                  onChange={(event) => setEditTag(event.target.value)}
                  maxLength={64}
                  placeholder="US nodes"
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditTarget(null);
                    setEditSubmitting(false);
                  }}
                  disabled={editSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={editSubmitting}>
                  {editSubmitting ? "Saving…" : "Save changes"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
