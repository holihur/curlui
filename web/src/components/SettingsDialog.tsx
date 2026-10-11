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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LOCALES, useI18n, type Locale, type Theme } from "@/lib/i18n";
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

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="flex-1">
        {label}
        {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, theme, setTheme, locale, setLocale } = useI18n();
  const toast = useStore((s) => s.toast);
  const features = useStore((s) => s.features);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const rightOpen = useStore((s) => s.rightOpen);
  const setRightOpen = useStore((s) => s.setRightOpen);
  const bottomOpen = useStore((s) => s.bottomOpen);
  const setBottomOpen = useStore((s) => s.setBottomOpen);
  const feedbackHidden = useStore((s) => s.feedbackHidden);
  const setFeedbackHidden = useStore((s) => s.setFeedbackHidden);
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
  const [aiProvider, setAiProvider] = useState("anthropic");
  const [aiKey, setAiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiConfigured, setAiConfigured] = useState(false);
  const [tokens, setTokens] = useState<
    { id: string; name: string; scopes: string[]; createdAt: string }[]
  >([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [newToken, setNewToken] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [tokenScopes, setTokenScopes] = useState<string[]>(["read"]);
  const [info, setInfo] = useState<{
    current: string;
    latest: string;
    hasUpdate: boolean;
    url: string;
  } | null>(null);
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
        setAiProvider(s.aiProvider || "anthropic");
        setAiBaseUrl(s.aiBaseUrl ?? "");
        setAiModel(s.aiModel ?? "");
        setAiKey("");
      })
      .catch(() => {});
    api.aiStatus().then((st) => setAiConfigured(st.configured)).catch(() => {});
    api.listScopes().then((r) => setScopes(r.scopes)).catch(() => {});
    void loadTokens();
  }, [open]);

  const loadTokens = async () => {
    try {
      const r = await api.listTokens();
      setTokens(r.tokens ?? []);
    } catch {
      setTokens([]);
    }
  };

  const createToken = async () => {
    try {
      const r = await api.createToken(tokenName.trim() || "token", tokenScopes);
      setNewToken(r.secret);
      setTokenName("");
      await loadTokens();
    } catch (err) {
      toast({
        title: t("requestFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
  };

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
        aiProvider,
        aiBaseUrl: aiBaseUrl.trim(),
        aiModel: aiModel.trim(),
        ...(aiKey.trim() ? { aiApiKey: aiKey.trim() } : {}),
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
      <DialogContent className="max-h-[86vh] w-[min(96vw,760px)] max-w-none grid-rows-[auto_1fr_auto] gap-3 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" /> {t("settings")}
          </DialogTitle>
          <DialogDescription />
        </DialogHeader>

        <Tabs defaultValue="general" className="flex min-h-0 flex-col">
          <TabsList className="h-9 w-full shrink-0 justify-start gap-1 bg-transparent p-0">
            <TabsTrigger value="general" className="px-3 text-xs">
              {t("general")}
            </TabsTrigger>
            <TabsTrigger value="appearance" className="px-3 text-xs">
              {t("appearance")}
            </TabsTrigger>
            <TabsTrigger value="view" className="px-3 text-xs">
              {t("view")}
            </TabsTrigger>
            {features.auth !== false && (
              <TabsTrigger value="team" className="px-3 text-xs">
                {t("team")}
              </TabsTrigger>
            )}
            {features.mcp !== false && (
              <TabsTrigger value="mcp" className="px-3 text-xs">
                {t("mcp")}
              </TabsTrigger>
            )}
            {features.ai !== false && (
              <TabsTrigger value="ai" className="px-3 text-xs">
                {t("ai")}
              </TabsTrigger>
            )}
            <TabsTrigger value="updates" className="px-3 text-xs">
              {t("updates")}
            </TabsTrigger>
          </TabsList>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            {/* General */}
            <TabsContent value="general" className="m-0 space-y-4">
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
            </TabsContent>

            {/* Appearance */}
            <TabsContent value="appearance" className="m-0 space-y-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>{t("theme")}</span>
                <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
                  <SelectTrigger className="h-8 w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t("themeAuto")}</SelectItem>
                    <SelectItem value="light">{t("themeLight")}</SelectItem>
                    <SelectItem value="dark">{t("themeDark")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>{t("language")}</span>
                <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
                  <SelectTrigger className="h-8 w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCALES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            {/* View */}
            <TabsContent value="view" className="m-0 space-y-3">
              <Row label={t("panelLeft")}>
                <Switch checked={!sidebarCollapsed} onCheckedChange={(v) => setSidebarCollapsed(!v)} />
              </Row>
              {features.proxy !== false && (
                <Row label={t("panelBottom")}>
                  <Switch checked={bottomOpen} onCheckedChange={setBottomOpen} />
                </Row>
              )}
              <Row label={t("panelRight")}>
                <Switch checked={rightOpen} onCheckedChange={setRightOpen} />
              </Row>
              <Row label={t("feedbackShow")}>
                <Switch checked={!feedbackHidden} onCheckedChange={(v) => setFeedbackHidden(!v)} />
              </Row>
            </TabsContent>

            {/* Team */}
            {features.auth !== false && (
              <TabsContent value="team" className="m-0 space-y-3">
                <Row label={t("requireLogin")} hint={t("requireLoginHint")}>
                  <Switch checked={authOn} onCheckedChange={setAuthOn} />
                </Row>

                <Row label={t("oidcEnable")}>
                  <Switch checked={oidcOn} onCheckedChange={setOidcOn} />
                </Row>
                {oidcOn && (
                  <div className="space-y-2 rounded-md border p-2">
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

                {/* Personal access tokens */}
                <div className="rounded-md border p-2">
                  <div className="mb-2 text-xs font-medium">{t("tokens")}</div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Input
                      className="h-8 w-32 text-xs"
                      placeholder={t("tokenName")}
                      value={tokenName}
                      onChange={(e) => setTokenName(e.target.value)}
                    />
                    {scopes.map((sc) => (
                      <button
                        key={sc}
                        type="button"
                        onClick={() =>
                          setTokenScopes((cur) =>
                            cur.includes(sc) ? cur.filter((x) => x !== sc) : [...cur, sc],
                          )
                        }
                        className={
                          "rounded border px-1.5 py-0.5 text-[10px] " +
                          (tokenScopes.includes(sc)
                            ? "border-primary bg-primary/10 text-primary"
                            : "text-muted-foreground")
                        }
                      >
                        {sc}
                      </button>
                    ))}
                    <Button size="sm" className="h-8 text-xs" onClick={() => void createToken()}>
                      {t("tokenNew")}
                    </Button>
                  </div>
                  {newToken && (
                    <div className="mt-2">
                      <p className="text-[11px] text-amber-400">{t("tokenCreated")}</p>
                      <code className="mt-1 block break-all rounded bg-muted p-1.5 font-mono text-[10px]">
                        {newToken}
                      </code>
                    </div>
                  )}
                  <div className="mt-2 space-y-1">
                    {tokens.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">{t("tokenNone")}</p>
                    )}
                    {tokens.map((tk) => (
                      <div key={tk.id} className="flex items-center gap-2 text-[11px]">
                        <span className="font-medium">{tk.name}</span>
                        <span className="text-muted-foreground">{tk.scopes.join(", ")}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-6 text-[10px] text-destructive"
                          onClick={async () => {
                            await api.deleteToken(tk.id);
                            await loadTokens();
                          }}
                        >
                          {t("tokenRevoke")}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            )}

            {/* MCP */}
            {features.mcp !== false && (
              <TabsContent value="mcp" className="m-0 space-y-3">
                <p className="text-[11px] text-muted-foreground">{t("mcpHint")}</p>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm">{t("mcpEnable")}</span>
                  <Switch checked={mcpOn} onCheckedChange={setMcpOn} />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm">
                    {t("mcpWriteTools")}{" "}
                    <span className="text-[10px] text-muted-foreground">
                      ({t("mcpReadGroup")} + {t("mcpWriteGroup")})
                    </span>
                  </span>
                  <Switch checked={mcpWrite} onCheckedChange={setMcpWrite} disabled={!mcpOn} />
                </div>
              </TabsContent>
            )}

            {/* AI (BYOK) */}
            {features.ai !== false && (
              <TabsContent value="ai" className="m-0 space-y-3">
                <p className="text-[11px] text-muted-foreground">{t("aiHint")}</p>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>{t("aiProvider")}</span>
                  <Select value={aiProvider} onValueChange={setAiProvider}>
                    <SelectTrigger className="h-8 w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      <SelectItem value="openai">OpenAI compatible</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Field label={t("aiApiKey")}>
                  <Input
                    type="password"
                    className="font-mono text-xs"
                    value={aiKey}
                    onChange={(e) => setAiKey(e.target.value)}
                    placeholder={aiConfigured ? "••••••••" : "sk-…"}
                    spellCheck={false}
                  />
                  {aiConfigured && (
                    <p className="text-[11px] text-emerald-400">{t("aiConfigured")}</p>
                  )}
                </Field>
                <Field label={t("aiBaseUrl")}>
                  <Input
                    className="font-mono text-xs"
                    value={aiBaseUrl}
                    onChange={(e) => setAiBaseUrl(e.target.value)}
                    placeholder="https://api.anthropic.com"
                    spellCheck={false}
                  />
                </Field>
                <Field label={t("aiModel")}>
                  <Input
                    className="font-mono text-xs"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    placeholder="claude-sonnet-4-5"
                    spellCheck={false}
                  />
                </Field>
              </TabsContent>
            )}

            {/* Updates */}
            <TabsContent value="updates" className="m-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void check()}
                  disabled={checking}
                >
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
              {info && !info.hasUpdate && (
                <p className="text-xs text-emerald-400">{t("upToDate")}</p>
              )}
              {info && info.hasUpdate && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-amber-400">
                    {t("updateAvailable")}: {info.latest}
                  </span>
                  <Button size="sm" className="gap-1.5" onClick={() => void doUpdate()} disabled={updating}>
                    <RefreshCw className={updating ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                    {updating ? t("updating") : t("updateNow")}
                  </Button>
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>

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
