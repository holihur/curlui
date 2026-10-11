import { useEffect, useState, type ReactNode } from "react";
import { RefreshCw, Settings as SettingsIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useStore } from "@/store";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);
  const features = useStore((s) => s.features);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const rightOpen = useStore((s) => s.rightOpen);
  const setRightOpen = useStore((s) => s.setRightOpen);
  const bottomOpen = useStore((s) => s.bottomOpen);
  const setBottomOpen = useStore((s) => s.setBottomOpen);
  const [webhook, setWebhook] = useState("");
  const [userAgent, setUserAgent] = useState("");
  const [mcpOn, setMcpOn] = useState(true);
  const [mcpWrite, setMcpWrite] = useState(false);
  const [authOn, setAuthOn] = useState(false);
  const [oidcOn, setOidcOn] = useState(false);
  const [oidcIssuer, setOidcIssuer] = useState("");
  const [oidcClientId, setOidcClientId] = useState("");
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [oidcLabel, setOidcLabel] = useState("");
  const [oidcAutoCreate, setOidcAutoCreate] = useState(true);
  const [oidcRole, setOidcRole] = useState("member");
  const [info, setInfo] = useState<{ current: string; latest: string; hasUpdate: boolean; url: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      setInfo(await api.checkUpdate());
    } catch (err) {
      toast({
        title: t("requestFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setChecking(false);
    }
  };

  const doUpdate = async () => {
    setUpdating(true);
    try {
      const r = await api.applyUpdate();
      toast({
        title: r.updated ? `${t("latestVersion")}: ${r.version}` : t("upToDate"),
        description: r.restartRequired ? t("restartRequired") : undefined,
        variant: "success",
      });
      setInfo(null);
    } catch (err) {
      toast({
        title: t("requestFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    api
      .getSettings()
      .then((s) => {
        setWebhook(s.notifyWebhook ?? "");
        setUserAgent(s.userAgent ?? "");
        setMcpOn(s.mcpEnabled !== "0");
        setMcpWrite(s.mcpWrite === "1");
        setAuthOn(s.authEnabled === "1");
        setOidcOn(s.oidcEnabled === "1");
        setOidcIssuer(s.oidcIssuer ?? "");
        setOidcClientId(s.oidcClientId ?? "");
        setOidcClientSecret(s.oidcClientSecret ?? "");
        setOidcLabel(s.oidcButtonLabel ?? "");
        setOidcAutoCreate(s.oidcAutoCreate !== "0");
        setOidcRole(s.oidcDefaultRole || "member");
      })
      .catch(() => {});
  }, [open]);

  const save = async () => {
    try {
      await api.saveSettings({
        notifyWebhook: webhook.trim(),
        userAgent: userAgent.trim(),
        mcpEnabled: mcpOn ? "1" : "0",
        mcpWrite: mcpWrite ? "1" : "0",
        authEnabled: authOn ? "1" : "0",
        oidcEnabled: oidcOn ? "1" : "0",
        oidcIssuer: oidcIssuer.trim(),
        oidcClientId: oidcClientId.trim(),
        oidcClientSecret,
        oidcButtonLabel: oidcLabel.trim(),
        oidcAutoCreate: oidcAutoCreate ? "1" : "0",
        oidcDefaultRole: oidcRole,
      });
      await useStore.getState().loadAuth();
      toast({ title: t("settingsSaved"), variant: "success" });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: t("saveFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" /> {t("settings")}
          </DialogTitle>
          <DialogDescription />
        </DialogHeader>

        <Field label={t("failureWebhook")}>
          <Input
            value={webhook}
            onChange={(e) => setWebhook(e.target.value)}
            placeholder="https://hooks.example.com/curlui"
            className="font-mono text-xs"
            spellCheck={false}
          />
          <p className="text-[11px] text-muted-foreground">{t("failureWebhookHint")}</p>
        </Field>

        <Field label={t("userAgent")}>
          <Input
            value={userAgent}
            onChange={(e) => setUserAgent(e.target.value)}
            placeholder="curlui/1.0"
            className="font-mono text-xs"
            spellCheck={false}
          />
          <p className="text-[11px] text-muted-foreground">{t("userAgentHint")}</p>
        </Field>

        <div className="border-t pt-4">
          <div className="mb-2 text-sm font-medium">{t("view")}</div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{t("panelLeft")}</span>
            <Switch checked={!sidebarCollapsed} onCheckedChange={(v) => setSidebarCollapsed(!v)} />
          </label>
          {features.proxy !== false && (
            <label className="mt-2 flex items-center justify-between gap-3 text-sm">
              <span>{t("panelBottom")}</span>
              <Switch checked={bottomOpen} onCheckedChange={setBottomOpen} />
            </label>
          )}          <label className="mt-2 flex items-center justify-between gap-3 text-sm">
            <span>{t("panelRight")}</span>
            <Switch checked={rightOpen} onCheckedChange={setRightOpen} />
          </label>
        </div>

        {features.auth !== false && (
        <div className="border-t pt-4">
          <div className="mb-2 text-sm font-medium">{t("team")}</div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="flex-1">
              {t("requireLogin")}              <span className="mt-0.5 block text-[11px] text-muted-foreground">{t("requireLoginHint")}</span>
            </span>
            <Switch checked={authOn} onCheckedChange={setAuthOn} />
          </label>

          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <span className="flex-1">{t("oidcEnable")}</span>
            <Switch checked={oidcOn} onCheckedChange={setOidcOn} />
          </div>
          {oidcOn && (
            <div className="mt-2 space-y-2 rounded-md border p-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t("oidcIssuer")}</span>
                <Input
                  className="h-8 font-mono text-xs"
                  placeholder="https://accounts.example.com"
                  value={oidcIssuer}
                  onChange={(e) => setOidcIssuer(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  className="h-8 font-mono text-xs"
                  placeholder={t("clientId")}
                  value={oidcClientId}
                  onChange={(e) => setOidcClientId(e.target.value)}
                  spellCheck={false}
                />
                <Input
                  className="h-8 font-mono text-xs"
                  type="password"
                  placeholder={t("clientSecret")}
                  value={oidcClientSecret}
                  onChange={(e) => setOidcClientSecret(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  className="h-8 text-xs"
                  placeholder={t("oidcButtonLabel")}
                  value={oidcLabel}
                  onChange={(e) => setOidcLabel(e.target.value)}
                />
                <select
                  className="h-8 rounded-md border bg-background px-2 text-xs"
                  value={oidcRole}
                  onChange={(e) => setOidcRole(e.target.value)}
                >
                  <option value="member">{t("roleMember")}</option>
                  <option value="viewer">{t("roleViewer")}</option>
                  <option value="admin">{t("roleAdmin")}</option>
                </select>
              </div>
              <label className="flex items-center justify-between gap-3 text-xs">
                <span>{t("oidcAutoCreate")}</span>
                <Switch checked={oidcAutoCreate} onCheckedChange={setOidcAutoCreate} />
              </label>
              <p className="text-[11px] text-muted-foreground">
                Redirect URI: <code>{"/api/auth/oidc/callback"}</code>
              </p>
            </div>
          )}
        </div>
        )}

        <div className="border-t pt-4">
          <div className="mb-2 text-sm font-medium">{t("updates")}</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void check()} disabled={checking}>
              <RefreshCw className={checking ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              {t("checkForUpdates")}
            </Button>
            {info && (
              <span className="text-xs text-muted-foreground">
                {t("currentVersion")}: v{info.current.replace(/^v/, "")}
                {info.latest ? ` · ${t("latestVersion")}: ${info.latest}` : ""}
              </span>
            )}
          </div>
          {info && !info.hasUpdate && <p className="mt-2 text-xs text-emerald-400">{t("upToDate")}</p>}
          {info && info.hasUpdate && (
            <div className="mt-2 flex items-center gap-3">
              <span className="text-xs text-amber-400">
                {t("updateAvailable")}: {info.latest}
              </span>
              <Button size="sm" className="gap-1.5" onClick={() => void doUpdate()} disabled={updating}>
                <RefreshCw className={updating ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                {updating ? t("updating") : t("updateNow")}
              </Button>
            </div>
          )}
        </div>

        {features.mcp !== false && (
        <div className="border-t pt-4">
          <div className="text-sm font-medium">{t("mcp")}</div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t("mcpHint")}</p>
          <div className="mt-2 flex items-center justify-between rounded-lg border p-3">
            <span className="text-sm">{t("mcpEnable")}</span>
            <Switch checked={mcpOn} onCheckedChange={setMcpOn} />
          </div>
          <div className="mt-2 flex items-center justify-between rounded-lg border p-3">
            <span className="text-sm">
              {t("mcpWriteTools")}{" "}
              <span className="text-[10px] text-muted-foreground">
                ({t("mcpReadGroup")} + {t("mcpWriteGroup")})
              </span>
            </span>
            <Switch checked={mcpWrite} onCheckedChange={setMcpWrite} disabled={!mcpOn} />
          </div>
        </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()}>{t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
