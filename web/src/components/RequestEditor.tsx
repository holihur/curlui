import { useEffect, useRef, useState, lazy, Suspense, type ReactNode } from "react";
import { AlertCircle, Bug, CheckCircle2, ChevronDown, ChevronRight, Clock, Code2, Database, FlaskConical, Loader2, Play, Radio, Save, Send, Square, Wand2, XCircle } from "lucide-react";
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
import { ResponsePanel } from "@/components/ResponsePanel";
import { cn, jsonError } from "@/lib/utils";

// Dialogs are loaded on demand (not part of the first paint).
const ScheduleDialog = lazy(() =>
  import("@/components/ScheduleDialog").then((m) => ({ default: m.ScheduleDialog })),
);
const RunDialog = lazy(() => import("@/components/RunDialog").then((m) => ({ default: m.RunDialog })));
const FuzzDialog = lazy(() => import("@/components/FuzzDialog").then((m) => ({ default: m.FuzzDialog })));
const CodeDialog = lazy(() => import("@/components/CodeDialog").then((m) => ({ default: m.CodeDialog })));
import { tryPrettyJSON } from "@/lib/highlight";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useActiveTab, useStore } from "@/store";
import type { AuthType, BodyType, GraphQLSchema, GrpcCall, GrpcStoredDescriptor, RequestDef } from "@/lib/types";
import { api } from "@/lib/api";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const BODY_TYPES: { value: BodyType; label: MessageKey }[] = [
  { value: "none", label: "bodyNone" },
  { value: "json", label: "bodyJson" },
  { value: "graphql", label: "bodyGraphql" },
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
  const streamMode = useStore((s) => s.streamMode);
  const setStreamMode = useStore((s) => s.setStreamMode);
  const stopStream = useStore((s) => s.stopStream);
  const saveActiveTab = useStore((s) => s.saveActiveTab);
  const status = useStore((s) => (tab?.sourceId ? s.testStatus[tab.sourceId] : undefined));
  const features = useStore((s) => s.features);

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
        {features.grpc !== false && (
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 px-2 text-[11px] font-semibold"
          title={t("grpc")}
          onClick={() =>
            updateActiveRequest(
              req.protocol === "grpc"
                ? { protocol: "http" }
                : {
                    protocol: "grpc",
                    grpc: req.grpc ?? {
                      target: "localhost:50051",
                      service: "",
                      method: "",
                      descriptorId: "",
                      plaintext: true,
                      body: "{}",
                    },
                  },
            )
          }
        >
          {req.protocol === "grpc" ? "gRPC" : "HTTP"}
        </Button>
        )}

        {req.protocol === "grpc" ? (
          <Input
            value={req.grpc?.target ?? ""}
            onChange={(e) =>
              updateActiveRequest({
                grpc: {
                  service: "",
                  method: "",
                  descriptorId: "",
                  plaintext: true,
                  body: "{}",
                  ...(req.grpc ?? {}),
                  target: e.target.value,
                },
              })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") void send();
            }}
            placeholder="localhost:50051"
            className="h-9 min-w-[140px] flex-1 font-mono text-sm"
            spellCheck={false}
          />
        ) : (
          <>
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
          </>
        )}

        <div className="flex">
          {tab.request.protocol !== "grpc" && (
            <button
              type="button"
              onClick={() => setStreamMode(!streamMode)}
              title={t("stream")}
              className={cn(
                "flex h-9 items-center gap-1 rounded-l-md border px-2 text-xs font-medium transition-colors",
                streamMode
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              <Radio className="h-4 w-4" />
            </button>
          )}
          <Button
            className={cn(
              "h-9 w-9 gap-1.5 rounded-r-none px-0 sm:w-[96px] sm:px-4",
              tab.request.protocol !== "grpc" && "rounded-l-none",
            )}
            onClick={() => (tab.sending && streamMode ? stopStream() : void send())}
            disabled={tab.sending && !streamMode}
            title={tab.sending && streamMode ? t("stop") : t("send")}
            variant={tab.sending && streamMode ? "destructive" : "default"}
          >
            {tab.sending ? (
              streamMode ? <Square className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">{tab.sending && streamMode ? t("stop") : t("send")}</span>
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
              {features.scheduler !== false && (
              <DropdownMenuItem onClick={() => setScheduleOpen(true)}>
                <Clock /> {t("scheduleSend")}
              </DropdownMenuItem>
              )}
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
        {req.protocol === "grpc" ? (
          <GrpcEditor req={req} onChange={updateActiveRequest} />
        ) : (
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
        )}
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

      {codeOpen && (
        <Suspense fallback={null}>
          <CodeDialog open onOpenChange={setCodeOpen} request={req} />
        </Suspense>
      )}
      {scheduleOpen && (
        <Suspense fallback={null}>
          <ScheduleDialog open onOpenChange={setScheduleOpen} request={req} />
        </Suspense>
      )}
      {runOpen && (
        <Suspense fallback={null}>
          <RunDialog
            open
            onOpenChange={setRunOpen}
            title={t("loadTest")}
            items={[{ name: req.name || req.url, request: req }]}
            defaultRepeat={10}
          />
        </Suspense>
      )}
      {fuzzOpen && (
        <Suspense fallback={null}>
          <FuzzDialog open onOpenChange={setFuzzOpen} request={req} />
        </Suspense>
      )}
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
  const toast = useStore((s) => s.toast);
  const setBody = (patch: Partial<RequestDef["body"]>) => onChange({ body: { ...req.body, ...patch } });
  const type = req.body.type;
  const isRaw = type === "json" || type === "xml" || type === "html" || type === "text";
  const jsonErr = type === "json" ? jsonError(req.body.raw) : null;
  const hasJson = type === "json" && req.body.raw.trim().length > 0;

  // GraphQL schema introspection.
  const [schema, setSchema] = useState<GraphQLSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaFilter, setSchemaFilter] = useState("");
  const [expandedType, setExpandedType] = useState<string | null>(null);

  const loadSchema = async () => {
    setSchemaLoading(true);
    try {
      const s = await api.introspectGraphQL(req);
      setSchema(s);
      toast({ title: t("graphqlLoaded"), variant: "success" });
    } catch (err) {
      toast({
        title: t("graphqlSchema"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setSchemaLoading(false);
    }
  };

  const insertField = (name: string) => {
    const q = (req.body.query ?? "").trimEnd();
    setBody({ query: q ? `${q}\n  ${name}` : `  ${name}` });
    toast({ title: t("graphqlInserted"), description: name, variant: "success" });
  };

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

      {type === "graphql" && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">{t("graphqlQuery")}</span>
            <Input
              value={req.body.operationName ?? ""}
              placeholder={t("graphqlOperationName")}
              onChange={(e) => setBody({ operationName: e.target.value })}
              className="ml-auto h-7 w-40 font-mono text-[11px]"
            />
            <Button
              variant="outline"
              size="xs"
              className="h-7 gap-1"
              disabled={schemaLoading || !req.url.trim()}
              onClick={() => void loadSchema()}
            >
              {schemaLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Database className="h-3.5 w-3.5" />
              )}
              {t("graphqlLoadSchema")}
            </Button>
          </div>
          <CodeEditor
            value={req.body.query ?? ""}
            onChange={(query) => setBody({ query })}
            language="text"
            placeholder={"query ($id: ID!) {\n  user(id: $id) { id name }\n}"}
            className="min-h-[150px]"
          />
          <span className="text-[11px] font-medium text-muted-foreground">{t("graphqlVariables")}</span>
          <CodeEditor
            value={req.body.variables ?? ""}
            onChange={(variables) => setBody({ variables })}
            language="json"
            placeholder={'{\n  "id": "1"\n}'}
            className="min-h-[80px]"
          />
          <p className="text-[11px] text-muted-foreground">{t("graphqlHint")}</p>

          {schema && (
            <div className="rounded-md border">
              <div className="flex items-center gap-2 border-b bg-muted/30 px-2 py-1">
                <span className="text-[11px] font-medium">{t("graphqlSchema")}</span>
                <span className="text-[10px] text-muted-foreground">
                  {schema.queryType}
                  {schema.mutationType ? ` · ${schema.mutationType}` : ""}
                </span>
                <Input
                  value={schemaFilter}
                  onChange={(e) => setSchemaFilter(e.target.value)}
                  placeholder={t("graphqlSearch")}
                  className="ml-auto h-6 w-44 text-[11px]"
                />
              </div>
              <div className="max-h-56 overflow-y-auto">
                {schema.types
                  .flatMap((tp) => {
                    const fields = tp.fields ?? tp.inputFields ?? [];
                    const f = schemaFilter.trim().toLowerCase();
                    const typeMatch = f === "" || tp.name.toLowerCase().includes(f);
                    const matchedFields = f === "" ? fields : fields.filter((x) => x.name.toLowerCase().includes(f));
                    if (f !== "" && !typeMatch && matchedFields.length === 0) return [];
                    return [{ tp, fields: typeMatch ? fields : matchedFields }];
                  })
                  .map(({ tp, fields }) => {
                    const open = expandedType === tp.name || (schemaFilter.trim() !== "" && fields.length > 0);
                    return (
                      <div key={tp.name}>
                        <button
                          onClick={() => setExpandedType(expandedType === tp.name ? null : tp.name)}
                          className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] hover:bg-accent"
                        >
                          <ChevronRight
                            className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")}
                          />
                          <span className="font-mono font-medium">{tp.name}</span>
                          <span className="text-[10px] text-muted-foreground">{tp.kind}</span>
                        </button>
                        {open && (
                          <div className="border-t bg-muted/20">
                            {fields.map((fl) => (
                              <button
                                key={fl.name}
                                onClick={() => insertField(fl.name)}
                                className="flex w-full items-center gap-2 px-6 py-0.5 text-left text-[11px] hover:bg-accent"
                              >
                                <span className="font-mono">{fl.name}</span>
                                {fl.args && fl.args.length > 0 && (
                                  <span className="truncate text-[10px] text-muted-foreground">
                                    ({fl.args.map((a) => `${a.name}: ${a.type}`).join(", ")})
                                  </span>
                                )}
                                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                                  {fl.type}
                                </span>
                              </button>
                            ))}
                            {(tp.enumValues ?? []).map((v) => (
                              <div key={v} className="px-6 py-0.5 font-mono text-[11px] text-muted-foreground">
                                {v}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
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

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <div className="text-sm font-medium">{t("cookieJar")}</div>
          <div className="text-xs text-muted-foreground">{t("cookieJarDesc")}</div>
        </div>
        <Switch
          checked={req.options.useCookieJar ?? false}
          onCheckedChange={(v) => setOpts({ useCookieJar: v })}
        />
      </div>

      <Field label={t("clientCert")}>
        <p className="text-[11px] text-muted-foreground">{t("clientCertDesc")}</p>
        <Textarea
          value={req.options.clientCert ?? ""}
          placeholder="-----BEGIN CERTIFICATE-----"
          onChange={(e) => setOpts({ clientCert: e.target.value })}
          className="min-h-[80px] font-mono text-[11px]"
          spellCheck={false}
        />
        <Textarea
          value={req.options.clientKey ?? ""}
          placeholder="-----BEGIN PRIVATE KEY-----"
          onChange={(e) => setOpts({ clientKey: e.target.value })}
          className="mt-2 min-h-[80px] font-mono text-[11px]"
          spellCheck={false}
        />
      </Field>
    </div>
  );
}

// GrpcEditor configures a saved gRPC request (protocol === "grpc").
function GrpcEditor({
  req,
  onChange,
}: {
  req: RequestDef;
  onChange: (patch: Partial<RequestDef>) => void;
}) {
  const { t } = useI18n();
  const [descriptors, setDescriptors] = useState<GrpcStoredDescriptor[]>([]);

  useEffect(() => {
    api
      .listGrpcDescriptors()
      .then((r) => setDescriptors(r.descriptors ?? []))
      .catch(() => {});
  }, []);

  const g: GrpcCall = req.grpc ?? {
    target: "localhost:50051",
    service: "",
    method: "",
    descriptorId: "",
    plaintext: true,
    body: "{}",
  };
  const setG = (patch: Partial<GrpcCall>) => onChange({ grpc: { ...g, ...patch } });

  const services = descriptors.find((d) => d.id === g.descriptorId)?.services ?? [];
  const current = services.find((s) => `${s.package ? s.package + "." : ""}${s.name}` === g.service);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("grpcSaved")}>
          <Select
            value={g.descriptorId}
            onValueChange={(v) => {
              const first = descriptors.find((d) => d.id === v)?.services?.[0];
              setG({
                descriptorId: v,
                service: first ? `${first.package ? first.package + "." : ""}${first.name}` : "",
                method: first?.methods?.[0]?.name ?? "",
              });
            }}
          >
            <SelectTrigger className="h-9 font-mono text-xs">
              <SelectValue placeholder={t("grpcNoDescriptors")} />
            </SelectTrigger>
            <SelectContent>
              {descriptors.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("grpcService")}>
          <Select
            value={g.service}
            onValueChange={(v) => {
              const svc = services.find((s) => `${s.package ? s.package + "." : ""}${s.name}` === v);
              setG({ service: v, method: svc?.methods?.[0]?.name ?? "" });
            }}
          >
            <SelectTrigger className="h-9 font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {services.map((s) => {
                const full = `${s.package ? s.package + "." : ""}${s.name}`;
                return (
                  <SelectItem key={full} value={full}>
                    {full}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("grpcMethod")}>
          <Select value={g.method} onValueChange={(v) => setG({ method: v })}>
            <SelectTrigger className="h-9 font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(current?.methods ?? []).map((m) => (
                <SelectItem key={m.name} value={m.name}>
                  {m.name}
                  {m.streaming ? " (stream)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch checked={g.plaintext} onCheckedChange={(v) => setG({ plaintext: v })} />
        {t("grpcPlaintext")}
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t("grpcMetadata")}</span>
        <KeyValueEditor items={g.metadata ?? []} onChange={(metadata) => setG({ metadata })} showDescription />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">JSON</span>
        <CodeEditor
          value={g.body}
          onChange={(body) => setG({ body })}
          language="json"
          className="min-h-[140px]"
          placeholder={'{\n  "service": ""\n}'}
        />
      </div>
    </div>
  );
}
