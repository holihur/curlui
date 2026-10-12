import { useEffect, useState } from "react";
import { Loader2, Trash2, UserPlus, Users, History, KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/store";
import type { User } from "@/lib/types";

export function TeamDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);
  const user = useStore((s) => s.user);
  const projectId = useStore((s) => s.projectId);
  const projects = useStore((s) => s.projects);
  const refreshProjects = useStore((s) => s.refreshProjects);

  const [users, setUsers] = useState<User[]>([]);
  const [audit, setAudit] = useState<
    { id: string; at: string; user: string; action: string; target?: string; detail?: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [nu, setNu] = useState({ username: "", password: "", name: "", role: "member" });
  const [memberRole, setMemberRole] = useState("member");
  const [memberId, setMemberId] = useState("");

  const isAdmin = user?.role === "admin";
  const [resetLink, setResetLink] = useState("");
  const project = projects.find((p) => p.id === projectId);
  const members = project?.members ?? {};
  const canManage = isAdmin || ["owner", "admin"].includes(useStore.getState().projectRole);

  const load = async () => {
    if (!isAdmin) return;
    try {
      const r = await api.listUsers();
      setUsers(r.users ?? []);
    } catch {
      /* ignore */
    }
    try {
      const a = await api.listAudit();
      setAudit(a.entries ?? []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fail = (err: unknown) =>
    toast({
      title: t("team"),
      description: err instanceof Error ? err.message : String(err),
      variant: "error",
    });

  const addUser = async () => {
    setBusy(true);
    try {
      await api.createUser(nu);
      setNu({ username: "", password: "", name: "", role: "member" });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (u: { id: string; username: string }) => {
    try {
      const r = await api.adminResetPassword(u.id);
      setResetLink(r.token);
      toast({ title: t("resetIssued"), description: u.username, variant: "success" });
    } catch (err) {
      toast({
        title: t("resetPassword"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
  };

  const removeUser = async (id: string) => {
    try {
      await api.deleteUser(id);
      await load();
      await refreshProjects();
    } catch (err) {
      fail(err);
    }
  };

  const addMember = async () => {
    if (!memberId) return;
    try {
      await api.setMember(projectId, memberId, memberRole);
      setMemberId("");
      await refreshProjects();
    } catch (err) {
      fail(err);
    }
  };

  const removeMember = async (id: string) => {
    try {
      await api.removeMember(projectId, id);
      await refreshProjects();
    } catch (err) {
      fail(err);
    }
  };

  const userName = (id: string) => {
    const u = users.find((x) => x.id === id);
    return u ? u.name || u.username : id.slice(0, 8);
  };

  const nonMembers = users.filter((u) => !(u.id in members) && u.id !== project?.ownerId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" /> {t("team")}
            {project && <span className="text-muted-foreground">· {project.name}</span>}
          </DialogTitle>
          <DialogDescription>
            {projectId === "local" ? t("members") : `${t("members")} · ${t("role")}`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 sm:grid-cols-2">
          {/* Members of the current project */}
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium">{t("members")}</div>
            <div className="flex flex-col gap-1 rounded-md border p-2">
              {project?.ownerId && (
                <div className="flex items-center justify-between px-1 py-1 text-sm">
                  <span>{userName(project.ownerId)}</span>
                  <span className="text-xs text-muted-foreground">{t("roleOwner")}</span>
                </div>
              )}
              {Object.entries(members).map(([uid, role]) => (
                <div key={uid} className="flex items-center justify-between px-1 py-1 text-sm">
                  <span>{userName(uid)}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">{role}</span>
                    {canManage && (
                      <button
                        onClick={() => void removeMember(uid)}
                        className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                        title={t("delete")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {!project?.ownerId && Object.keys(members).length === 0 && (
                <p className="px-1 py-2 text-xs text-muted-foreground">{t("noMembers")}</p>
              )}
            </div>

            {canManage && nonMembers.length > 0 && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Select value={memberId} onValueChange={setMemberId}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder={t("addMember")} />
                    </SelectTrigger>
                    <SelectContent>
                      {nonMembers.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name || u.username}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Select value={memberRole} onValueChange={setMemberRole}>
                  <SelectTrigger className="h-9 w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
                    <SelectItem value="member">{t("roleMember")}</SelectItem>
                    <SelectItem value="viewer">{t("roleViewer")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={!memberId} onClick={() => void addMember()}>
                  {t("addMember")}
                </Button>
              </div>
            )}
          </div>

          {/* User directory (admins) */}
          {isAdmin && (
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium">{t("createUser")}</div>
              <div className="flex flex-col gap-2 rounded-md border p-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">{t("username")}</Label>
                  <Input
                    className="h-8"
                    value={nu.username}
                    onChange={(e) => setNu({ ...nu, username: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">{t("displayName")}</Label>
                  <Input
                    className="h-8"
                    value={nu.name}
                    onChange={(e) => setNu({ ...nu, name: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">{t("password")}</Label>
                  <Input
                    className="h-8"
                    type="password"
                    value={nu.password}
                    onChange={(e) => setNu({ ...nu, password: e.target.value })}
                  />
                </div>
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={busy || !nu.username || !nu.password}
                  onClick={() => void addUser()}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                  {t("createUser")}
                </Button>
              </div>

              <div className="mt-1 text-sm font-medium">{t("username")}</div>
              <div className="flex flex-col gap-1 rounded-md border p-2">
                {users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between px-1 py-1 text-sm">
                    <span>
                      {u.name || u.username}{" "}
                      <span className="text-xs text-muted-foreground">@{u.username}</span>
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">{u.role}</span>
                      {isAdmin && (
                        <button
                          onClick={() => void resetPassword(u)}
                          title={t("resetPassword")}
                          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {u.id !== user?.id && (
                        <button
                          onClick={() => void removeUser(u.id)}
                          className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {resetLink && (
                <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
                  <p className="text-[11px] text-amber-400">{t("resetHint")}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded bg-background/60 p-1 font-mono text-[10px]">
                      {resetLink}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 text-[10px]"
                      onClick={() => {
                        void navigator.clipboard?.writeText(resetLink);
                        setResetLink("");
                      }}
                    >
                      {t("copy")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="mt-4 border-t pt-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <History className="h-3.5 w-3.5" /> {t("auditLog")}
            </div>
            <div className="max-h-56 overflow-auto rounded-md border">
              {audit.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">{t("noAudit")}</p>
              ) : (
                audit.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-2 border-b px-2 py-1.5 text-xs last:border-0"
                  >
                    <span className="w-16 shrink-0 font-mono text-muted-foreground">
                      {new Date(e.at).toLocaleTimeString()}
                    </span>
                    <span className="w-24 shrink-0 truncate">{e.user}</span>
                    <span className="w-28 shrink-0 truncate font-medium">{e.action}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {e.detail || e.target || ""}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
