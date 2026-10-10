import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Bug, CheckCircle2, ChevronDown, Clock, Code2, FlaskConical, Loader2, Play, Save, Send, Wand2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KeyValueEditor } from "@/components/KeyValueEditor";
import { CodeEditor } from "@/components/CodeEditor";
import { AutomationEditor } from "@/components/AutomationEditor";
import { ScheduleDialog } from "@/components/ScheduleDialog";
import { RunDialog } from "@/components/RunDialog";
import { FuzzDialog } from "@/components/FuzzDialog";
import { ResponsePanel } from "@/components/ResponsePanel";
import { CodeDialog } from "@/components/CodeDialog";
import { cn, jsonError } from "@/lib/utils";
import { tryPrettyJSON } from "@/lib/highlight";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useActiveTab, useStore } from "@/store";
import type { AuthType, BodyType, RequestDef } from "@/lib/types";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const BODY_TYPES: { value: BodyType; label: MessageKey }[] = [
  { value: "none", label: "bodyNone" },
  { value: "json", label: "bodyJson" },
  { value: "form-urlencoded", label: "bodyFormUrlencoded" },
  { value: "form-data", label: "bodyFormData" },
  { value: "xml", label: "bodyXml" },
  { value: "text", label: "bodyText" },
  { value: "html", label: "bodyHtml" },
  { value: "binary", label: "bodyBinary" },
];

export function RequestEditor() {
  const { t } = useI18n();
  const tab = useActiveTab();
  const updateActiveRequest = useStore((s) => s.updateActiveRequest);
  const send = useStore((s) => s.send);
  const saveActiveTab = useStore((s) => s.saveActiveTab);
  const status = useStore((s) => (tab?.sourceId ? s.testStatus[tab.sourceId] : undefined));

  const [codeOpen, setCodeOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [fuzzOpen, setFuzzOpen] = useState(false);
  const [configHeight, setConfigHeight] = useState(300);
  const dragging = useRef(false);
  const configRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current || !configRef.current) return;
      const top = configRef.current.getBoundingClientRect().top;
      const h = e.clientY - top;
      setConfigHeight(Math.min(Math.max(h, 150), window.innerHeight - 220));
    };
    const up = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "Enter") {
        e.preventDefault();
        void send();
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveActiveTab();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send, saveActiveTab]);

  if (!tab) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Code2 className="h-10 w-10 opacity-40" />
        <p className="text-sm">No request open. Press New to start.</p>
      </div>
    );
  }

  const req = tab.request;
  const activeParams = req.params.filter((p) => p.enabled && p.key).length;
  const activeHeaders = req.headers.filter((h) => h.enabled && h.key).length;
  const bodyJsonError = req.body.type === "json" ? jsonError(req.body.raw) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* URL bar */}
      <div className="flex flex-wrap items-center gap-2 border-b p-2 sm:p-2.5">
        <Select value={req.method} onValueChange={(v) => updateActiveRequest({ method: v })}>
          <SelectTrigger className={cn("h-9 w-[110px] shrink-0 font-semibold", `method-${req.method}`)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHODS.map((m) => (
              <SelectItem key={m} value={m} className={cn("font-semibold", `method-${m}`)}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={req.url}
          onChange={(e) => updateActiveRequest({ url: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
          placeholder={t("urlPlaceholder")}
          className="h-9 min-w-[140px] flex-1 font-mono text-sm"
          spellCheck={false}
        />

        <div className="flex">
          <Button
            className="h-9 w-9 gap-1.5 rounded-r-none px-0 sm:w-[96px] sm:px-4"
            onClick={() => void send()}
            disabled={tab.sending}
            title={t("send")}
          >
            {tab.sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="hidden sm:inline">{t("send")}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="h-9 rounded-l-none border-l border-primary-foreground/25 px-1.5"
                disabled={tab.sending}
                title={t("more")}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => void send()}>
                <Send /> {t("sendNow")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void send({ mock: true })}>
                <FlaskConical /> {t("sendAsMock")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setScheduleOpen(true)}>
                <Clock /> {t("scheduleSend")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRunOpen(true)}>
                <Play /> {t("loadTest")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFuzzOpen(true)}>
                <Bug /> {t("fuzz")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {req.options.sendVia === "browser" && (
          <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
            {t("browserBadge")}
          </span>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => void saveActiveTab()}>
              <Save className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("saveTooltip")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setCodeOpen(true)}>
              <Code2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("codeTooltip")}</TooltipContent>
        </Tooltip>
      </div>

      {tab.error && !tab.response && (
        <div className="flex items-center gap-2 border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {tab.error}
        </div>
      )}

      {/* Request configuration */}
      <div
        ref={configRef}
        className="flex shrink-0 flex-col overflow-hidden border-b bg-card/40"
        style={{ height: configHeight }}
      >
        <Tabs defaultValue="params" className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 overflow-x-auto border-b px-2 pt-1.5">
            <TabsList className="h-8 bg-transparent p-0">
              <TabTrigger value="params">
                {t("params")}
                {activeParams > 0 && <Count n={activeParams} />}
              </TabTrigger>
              <TabTrigger value="auth">{t("authorization")}</TabTrigger>
              <TabTrigger value="headers">
                {t("headers")}
                {activeHeaders > 0 && <Count n={activeHeaders} />}
              </TabTrigger>
              <TabTrigger value="body">
                {t("body")}
                {bodyJsonError && (
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" title={t("invalidJson")} />
                )}
              </TabTrigger>
              <TabTrigger value="automation">
                {t("automation")}
                {status && (
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      status === "pass" ? "bg-emerald-400" : "bg-red-400",
                    )}
                  />
                )}
              </TabTrigger>
              <TabTrigger value="options">{t("options")}</TabTrigger>
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TabsContent value="params" className="m-0">
              <KeyValueEditor items={req.params} showDescription onChange={(params) => updateActiveRequest({ params })} />
            </TabsContent>
            <TabsContent value="auth" className="m-0">
              <AuthEditor req={req} onChange={updateActiveRequest} />
            </TabsContent>
            <TabsContent value="headers" className="m-0">
              <KeyValueEditor items={req.headers} showDescription onChange={(headers) => updateActiveRequest({ headers })} />
            </TabsContent>
            <TabsContent value="body" className="m-0 h-full">
              <BodyEditor req={req} onChange={updateActiveRequest} />
            </TabsContent>
            <TabsContent value="automation" className="m-0 h-full">
              <AutomationEditor req={req} onChange={updateActiveRequest} />
            </TabsContent>
            <TabsContent value="options" className="m-0">
              <OptionsEditor req={req} onChange={updateActiveRequest} />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Drag handle */}
      <div
        className="group relative h-1.5 shrink-0 cursor-row-resize bg-border/40"
        onMouseDown={() => {
          dragging.current = true;
          document.body.style.cursor = "row-resize";
          document.body.style.userSelect = "none";
        }}
      >
        <div className="absolute inset-x-0 top-1/2 mx-auto h-0.5 w-16 -translate-y-1/2 rounded-full bg-muted-foreground/0 transition-colors group-hover:bg-primary/70" />
      </div>

      <ResponsePanel tab={tab} />

      <CodeDialog open={codeOpen} onOpenChange={setCodeOpen} request={req} />
      <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} request={req} />
      <RunDialog
        open={runOpen}
        onOpenChange={setRunOpen}
        title={t("loadTest")}
        items={[{ name: req.name || req.url, request: req }]}
        defaultRepeat={10}
      />
      <FuzzDialog open={fuzzOpen} onOpenChange={setFuzzOpen} request={req} />
    </div>
  );
}

function TabTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="rounded-none border-b-2 border-transparent !bg-transparent px-3 py-2 text-xs data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
    >
      {children}
    </TabsTrigger>
  );
}

function Count({ n }: { n: number }) {
  return <span className="rounded bg-primary/20 px-1 text-[10px] text-primary">{n}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function AuthEditor({
  req,
  onChange,
}: {
  req: RequestDef;
  onChange: (patch: Partial<RequestDef>) => void;
}) {
  const { t } = useI18n();
  const setAuth = (patch: Partial<RequestDef["auth"]>) => onChange({ auth: { ...req.auth, ...patch } });

  return (
    <div className="max-w-xl space-y-4 p-4">
      <Field label={t("authType")}>
        <Select value={req.auth.type} onValueChange={(v) => setAuth({ type: v as AuthType })}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("noAuth")}</SelectItem>
            <SelectItem value="basic">{t("basicAuth")}</SelectItem>
            <SelectItem value="bearer">{t("bearerToken")}</SelectItem>
            <SelectItem value="apikey">{t("apiKey")}</SelectItem>
            <SelectItem value="oauth2">{t("oauth2")}</SelectItem>
            <SelectItem value="jwt">{t("jwt")}</SelectItem>
            <SelectItem value="aws">{t("awsSigV4")}</SelectItem>
            <SelectItem value="digest">{t("digestAuth")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {req.auth.type === "none" && <p className="text-xs text-muted-foreground">{t("noAuthHint")}</p>}

      {req.auth.type === "basic" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("username")}>
            <Input value={req.auth.username ?? ""} onChange={(e) => setAuth({ username: e.target.value })} />
          </Field>
          <Field label={t("password")}>
            <Input
              type="password"
              value={req.auth.password ?? ""}
              onChange={(e) => setAuth({ password: e.target.value })}
            />
          </Field>
        </div>
      )}

      {req.auth.type === "bearer" && (
        <Field label={t("token")}>
          <Input
            value={req.auth.token ?? ""}
            placeholder="{{token}}"
            onChange={(e) => setAuth({ token: e.target.value })}
            className="font-mono text-xs"
          />
        </Field>
      )}

      {req.auth.type === "apikey" && (
        <div className="grid grid-cols-3 gap-3">
          <Field label={t("key")}>
            <Input
              value={req.auth.key ?? ""}
              placeholder="X-API-Key"
              onChange={(e) => setAuth({ key: e.target.value })}
            />
          </Field>
          <Field label={t("value")}>
            <Input
              value={req.auth.value ?? ""}
              placeholder="{{api_key}}"
              onChange={(e) => setAuth({ value: e.target.value })}
            />
          </Field>
          <Field label={t("addTo")}>
            <Select
              value={req.auth.addTo ?? "header"}
              onValueChange={(v) => setAuth({ addTo: v as "header" | "query" })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="header">{t("header")}</SelectItem>
                <SelectItem value="query">{t("queryParam")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}

      {req.auth.type === "digest" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("username")}>
            <Input value={req.auth.username ?? ""} onChange={(e) => setAuth({ username: e.target.value })} />
          </Field>
          <Field label={t("password")}>
            <Input
              type="password"
              value={req.auth.password ?? ""}
              onChange={(e) => setAuth({ password: e.target.value })}
            />
          </Field>
        </div>
      )}

      {req.auth.type === "oauth2" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("grantType")}>
              <Select
                value={req.auth.grantType ?? "client_credentials"}
                onValueChange={(v) => setAuth({ grantType: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client_credentials">{t("clientCredentials")}</SelectItem>
                  <SelectItem value="password">{t("passwordGrant")}</SelectItem>
                  <SelectItem value="refresh_token">{t("refreshTokenGrant")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("clientAuth")}>
              <Select
                value={req.auth.clientAuth ?? "basic"}
                onValueChange={(v) => setAuth({ clientAuth: v as "basic" | "body" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="basic">{t("clientAuthBasic")}</SelectItem>
                  <SelectItem value="body">{t("clientAuthBody")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label={t("tokenUrl")}>
            <Input
              value={req.auth.tokenUrl ?? ""}
              placeholder="https://id.example.com/oauth/token"
              onChange={(e) => setAuth({ tokenUrl: e.target.value })}
              className="font-mono text-xs"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("clientId")}>
              <Input
                value={req.auth.clientId ?? ""}
                onChange={(e) => setAuth({ clientId: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
            <Field label={t("clientSecret")}>
              <Input
                type="password"
                value={req.auth.clientSecret ?? ""}
                onChange={(e) => setAuth({ clientSecret: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
          </div>
          {req.auth.grantType === "password" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("username")}>
                <Input value={req.auth.username ?? ""} onChange={(e) => setAuth({ username: e.target.value })} />
              </Field>
              <Field label={t("password")}>
                <Input
                  type="password"
                  value={req.auth.password ?? ""}
                  onChange={(e) => setAuth({ password: e.target.value })}
                />
              </Field>
            </div>
          )}
          {req.auth.grantType === "refresh_token" && (
            <Field label={t("refreshTokenGrant")}>
              <Input
                value={req.auth.refreshToken ?? ""}
                onChange={(e) => setAuth({ refreshToken: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
          )}
          <Field label={t("scope")}>
            <Input
              value={req.auth.scope ?? ""}
              placeholder="read write"
              onChange={(e) => setAuth({ scope: e.target.value })}
              className="font-mono text-xs"
            />
          </Field>
        </div>
      )}

      {req.auth.type === "jwt" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("jwtAlg")}>
              <Select value={req.auth.jwtAlg ?? "HS256"} onValueChange={(v) => setAuth({ jwtAlg: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HS256">HS256</SelectItem>
                  <SelectItem value="HS384">HS384</SelectItem>
                  <SelectItem value="HS512">HS512</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("jwtSecret")}>
              <Input
                type="password"
                value={req.auth.jwtSecret ?? ""}
                onChange={(e) => setAuth({ jwtSecret: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
          </div>
          <Field label={t("jwtClaims")}>
            <Textarea
              value={req.auth.jwtClaims ?? ""}
              placeholder={'{"sub":"1234567890","name":"John Doe"}'}
              onChange={(e) => setAuth({ jwtClaims: e.target.value })}
              className="min-h-[90px] font-mono text-xs"
              spellCheck={false}
            />
          </Field>
        </div>
      )}

      {req.auth.type === "aws" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("awsAccessKey")}>
              <Input
                value={req.auth.awsAccessKey ?? ""}
                onChange={(e) => setAuth({ awsAccessKey: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
            <Field label={t("awsSecretKey")}>
              <Input
                type="password"
                value={req.auth.awsSecretKey ?? ""}
                onChange={(e) => setAuth({ awsSecretKey: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("awsRegion")}>
              <Input
                value={req.auth.awsRegion ?? ""}
                placeholder="us-east-1"
                onChange={(e) => setAuth({ awsRegion: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
            <Field label={t("awsService")}>
              <Input
                value={req.auth.awsService ?? ""}
                placeholder="execute-api"
                onChange={(e) => setAuth({ awsService: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
          </div>
          <Field label={t("awsSessionToken")}>
            <Input
              value={req.auth.awsSessionToken ?? ""}
              onChange={(e) => setAuth({ awsSessionToken: e.target.value })}
              className="font-mono text-xs"
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function BodyEditor({
  req,
  onChange,
}: {
  req: RequestDef;
  onChange: (patch: Partial<RequestDef>) => void;
}) {
  const { t } = useI18n();
  const setBody = (patch: Partial<RequestDef["body"]>) => onChange({ body: { ...req.body, ...patch } });
  const type = req.body.type;
  const isRaw = type === "json" || type === "xml" || type === "html" || type === "text";
  const jsonErr = type === "json" ? jsonError(req.body.raw) : null;
  const hasJson = type === "json" && req.body.raw.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {BODY_TYPES.map((b) => (
            <button
              key={b.value}
              onClick={() => setBody({ type: b.value })}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                type === b.value
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t(b.label)}
            </button>
          ))}
        </div>
        {type === "json" && (
          <div className="ml-auto flex items-center gap-2">
            {hasJson &&
              (jsonErr ? (
                <span className="flex items-center gap-1 text-[11px] text-red-400">
                  <XCircle className="h-3.5 w-3.5" /> {t("invalidJson")}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {t("validJson")}
                </span>
              ))}
            <Button
              variant="ghost"
              size="xs"
              className="gap-1 text-muted-foreground"
              disabled={!!jsonErr || !hasJson}
              onClick={() => {
                const pretty = tryPrettyJSON(req.body.raw);
                if (pretty) setBody({ raw: pretty });
              }}
            >
              <Wand2 className="h-3.5 w-3.5" /> {t("beautify")}
            </Button>
          </div>
        )}
      </div>

      {jsonErr && (
        <div className="flex items-start gap-2 border-b bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="font-mono">{jsonErr}</span>
        </div>
      )}

      {isRaw && (
        <div className="min-h-0 flex-1">
          <CodeEditor
            value={req.body.raw}
            onChange={(raw) => setBody({ raw })}
            language={type === "json" ? "json" : "text"}
            placeholder={type === "json" ? t("bodyPlaceholder") : t("requestBodyPlaceholder")}
            className="h-full"
          />
        </div>
      )}

      {(type === "form-urlencoded" || type === "form-data") && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <KeyValueEditor
            items={req.body.form}
            showFiles={type === "form-data"}
            showDescription
            onChange={(form) => setBody({ form })}
          />
        </div>
      )}

      {type === "binary" && (
        <div className="p-4">
          <Field label={t("filePathLabel")}>
            <Input
              value={req.body.filePath ?? ""}
              placeholder="/home/user/data.bin"
              onChange={(e) => setBody({ filePath: e.target.value })}
              className="font-mono text-xs"
            />
          </Field>
        </div>
      )}

      {type === "none" && (
        <div className="p-6 text-center text-xs text-muted-foreground">{t("noBody")}</div>
      )}
    </div>
  );
}

function OptionsEditor({
  req,
  onChange,
}: {
  req: RequestDef;
  onChange: (patch: Partial<RequestDef>) => void;
}) {
  const { t } = useI18n();
  const setOpts = (patch: Partial<RequestDef["options"]>) =>
    onChange({ options: { ...req.options, ...patch } });

  return (
    <div className="max-w-xl space-y-4 p-4">
      <Field label={t("sendVia")}>
        <div className="flex gap-1">
          {(["server", "browser"] as const).map((v) => {
            const active = (req.options.sendVia ?? "server") === v;
            return (
              <button
                key={v}
                onClick={() => setOpts({ sendVia: v })}
                className={cn(
                  "flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {v === "server" ? t("viaServer") : t("viaBrowser")}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">{t("sendViaHint")}</p>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label={t("timeoutMs")}>
          <Input
            type="number"
            value={req.options.timeout}
            onChange={(e) => setOpts({ timeout: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label={t("maxRedirects")}>
          <Input
            type="number"
            value={req.options.maxRedirects ?? 10}
            onChange={(e) => setOpts({ maxRedirects: Number(e.target.value) || 0 })}
          />
        </Field>
      </div>

      <Field label={t("proxy")}>
        <Input
          value={req.options.proxy ?? ""}
          placeholder="http://127.0.0.1:7890"
          onChange={(e) => setOpts({ proxy: e.target.value })}
          className="font-mono text-xs"
        />
      </Field>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <div className="text-sm font-medium">{t("followRedirects")}</div>
          <div className="text-xs text-muted-foreground">{t("followRedirectsDesc")}</div>
        </div>
        <Switch
          checked={req.options.followRedirects}
          onCheckedChange={(v) => setOpts({ followRedirects: v })}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <div className="text-sm font-medium">{t("verifyTls")}</div>
          <div className="text-xs text-muted-foreground">{t("verifyTlsDesc")}</div>
        </div>
        <Switch checked={req.options.verifyTLS} onCheckedChange={(v) => setOpts({ verifyTLS: v })} />
      </div>
    </div>
  );
}
