import type { ValidationIssue,
  ApiResponse,
  CollectionNode,
  Environment,
  ExtractRule,
  HistoryEntry,
  KeyValue,
  MockHit,
  OpenAPIResult,
  RequestDef,
  ScheduleJob,
  ScheduleResult,
  BatchResult,
  BatchSummary,
  CaptureEntry,
  FuzzResult,
  PendingIntercept,
  AuthStatus,
  User,
  Project,
  GraphQLSchema,
  FeedbackIssue,
  GrpcDescriptorResult,
  GrpcResult,
  GrpcStoredDescriptor,
} from "./types";

const BASE = "/api";

// --- auth + project context ------------------------------------------------

let authToken = typeof localStorage !== "undefined" ? localStorage.getItem("curlui.token") ?? "" : "";
let projectId = typeof localStorage !== "undefined" ? localStorage.getItem("curlui.project") ?? "local" : "local";

export function getProjectId() {
  return projectId;
}

// setApiContext stores the session token + active project and mirrors the
// project into a cookie so same-origin downloads (exports) are scoped too.
export function setApiContext(next: { token?: string; project?: string }) {
  if (next.token !== undefined) {
    authToken = next.token;
    if (typeof localStorage !== "undefined") {
      if (authToken) localStorage.setItem("curlui.token", authToken);
      else localStorage.removeItem("curlui.token");
    }
  }
  if (next.project !== undefined && next.project) {
    projectId = next.project;
    if (typeof localStorage !== "undefined") localStorage.setItem("curlui.project", projectId);
    if (typeof document !== "undefined") {
      document.cookie = `curlui_project=${encodeURIComponent(projectId)}; path=/; max-age=31536000; samesite=lax`;
    }
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Project": projectId,
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(BASE + path, {
    credentials: "same-origin",
    ...init,
    headers,
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: string }).error)
        : `request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  send(
    req: RequestDef,
    envId: string | null,
    variables?: Record<string, string>,
    parents?: RequestDef[],
    mock = false,
  ) {
    return request<{
      response: ApiResponse;
      historyId: string;
      variables?: Record<string, string>;
    }>("/send", {
      method: "POST",
      body: JSON.stringify({
        request: req,
        envId: envId ?? "",
        variables: variables ?? {},
        parents: parents ?? [],
        mock,
      }),
    });
  },

  // Streaming (SSE): runs the request server-side and forwards the response
  // incrementally. onEvent receives {type, data} for meta/chunk/done/error.
  async stream(
    req: RequestDef,
    envId: string | null,
    variables: Record<string, string> | undefined,
    parents: RequestDef[] | undefined,
    onEvent: (ev: { type: string; data: any }) => void,
    signal?: AbortSignal,
    lastEventId?: string,
  ) {
    const res = await fetch("/api/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: req,
        envId: envId ?? "",
        variables: variables ?? {},
        parents: parents ?? [],
        lastEventId: lastEventId ?? "",
      }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`stream failed: HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let type = "message";
        let data = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event: ")) type = line.slice(7);
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        if (!data) continue;
        try {
          onEvent({ type, data: JSON.parse(data) });
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  },

  // AI assistant (BYOK)
  aiProviders() {
    return request<{
      providers: { id: string; name: string; provider: string; model: string; baseUrl: string; configured: boolean }[];
      active: string;
      allow: string[] | null;
      deny: string[] | null;
    }>("/ai/providers");
  },
  saveAiProvider(p: { id?: string; name: string; provider: string; apiKey?: string; baseUrl: string; model: string }) {
    return request<{ id: string }>("/ai/providers", { method: "POST", body: JSON.stringify(p) });
  },
  deleteAiProvider(id: string) {
    return request<{ ok: boolean }>(`/ai/providers/${id}`, { method: "DELETE" });
  },
  setAiActive(id: string) {
    return request<{ ok: boolean }>("/ai/active", { method: "PUT", body: JSON.stringify({ id }) });
  },
  aiSettings() {
    return request<{ configured: boolean; provider: string; model: string; baseUrl: string }>(
      "/ai/settings",
    );
  },
  saveAiSettings(payload: { provider: string; apiKey?: string; baseUrl: string; model: string }) {
    return request<{ configured: boolean; provider: string; model: string; baseUrl: string }>(
      "/ai/settings",
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },
  confirmAI(id: string, decision: "once" | "always" | "deny") {
    return request<{ ok: boolean }>("/ai/confirm", {
      method: "POST",
      body: JSON.stringify({ id, decision }),
    });
  },
  aiStatus() {
    return request<{ configured: boolean; provider: string; model: string; baseUrl: string }>(
      "/ai/status",
    );
  },
  async aiChat(
    message: string,
    sessionId: string,
    onEvent: (ev: { text?: string; tool?: string; args?: any; error?: string; sessionId?: string; final?: boolean }) => void,
    signal?: AbortSignal,
  ) {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of raw.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch {
            /* ignore */
          }
        }
      }
    }
  },

  // Personal access tokens
  listScopes() {
    return request<{ scopes: string[] }>("/tokens/scopes");
  },
  listTokens() {
    return request<{ tokens: { id: string; name: string; scopes: string[]; createdAt: string; lastUsedAt?: string }[] }>(
      "/tokens",
    );
  },
  createToken(name: string, scopes: string[], expiresInDays = 0) {
    return request<{ token: { id: string; name: string; scopes: string[] }; secret: string }>("/tokens", {
      method: "POST",
      body: JSON.stringify({ name, scopes, expiresInDays }),
    });
  },
  deleteToken(id: string) {
    return request<{ ok: boolean }>(`/tokens/${id}`, { method: "DELETE" });
  },

  validateOpenAPI(req: RequestDef) {
    return request<{ issues: ValidationIssue[]; source: string; path?: string; note?: string }>(
      "/openapi/validate",
      { method: "POST", body: JSON.stringify({ request: req }) },
    );
  },

  // Collections
  listCollections() {
    return request<{ collections: CollectionNode[] }>("/collections");
  },
  createNode(payload: {
    parentId?: string;
    type: "folder" | "request";
    name: string;
    request?: RequestDef;
  }) {
    return request<CollectionNode>("/collections", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateNode(id: string, payload: { name?: string; request?: RequestDef }) {
    return request<CollectionNode>(`/collections/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  updateFolder(
    id: string,
    payload: { variables: KeyValue[]; setupNodeId: string; extract: ExtractRule[] },
  ) {
    return request<CollectionNode>(`/collections/${id}/folder`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  deleteNode(id: string) {
    return request<{ ok: boolean }>(`/collections/${id}`, { method: "DELETE" });
  },
  moveNode(id: string, parentId: string, siblingId = "", position = "after") {
    return request<{ ok: boolean }>(`/collections/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ parentId, siblingId, position }),
    });
  },
  duplicateNode(id: string) {
    return request<CollectionNode>(`/collections/${id}/duplicate`, {
      method: "POST",
    });
  },

  // History
  listHistory() {
    return request<{ history: HistoryEntry[] }>("/history");
  },
  clearHistory() {
    return request<{ ok: boolean }>("/history", { method: "DELETE" });
  },
  deleteHistory(id: string) {
    return request<{ ok: boolean }>(`/history/${id}`, { method: "DELETE" });
  },

  // Environments
  listEnvironments() {
    return request<{ environments: Environment[] }>("/environments");
  },
  saveEnvironment(env: Environment) {
    return request<Environment>("/environments", {
      method: "POST",
      body: JSON.stringify(env),
    });
  },
  deleteEnvironment(id: string) {
    return request<{ ok: boolean }>(`/environments/${id}`, { method: "DELETE" });
  },

  // Settings
  getSettings() {
    return request<Record<string, string>>("/settings");
  },
  saveSettings(settings: Record<string, string>) {
    return request<Record<string, string>>("/settings", {
      method: "POST",
      body: JSON.stringify(settings),
    });
  },

  // curl import/export
  parseCurl(command: string) {
    return request<RequestDef>("/curl/parse", {
      method: "POST",
      body: JSON.stringify({ command }),
    });
  },
  generateCurl(req: RequestDef) {
    return request<{ command: string }>("/curl/generate", {
      method: "POST",
      body: JSON.stringify(req),
    });
  },
  importPostman(content: string, parentId = "") {
    return request<{ count: number; collections: CollectionNode[] }>("/import/postman", {
      method: "POST",
      body: JSON.stringify({ content, parentId }),
    });
  },
  introspectGraphQL(req: RequestDef) {
    return request<GraphQLSchema>("/graphql/introspect", {
      method: "POST",
      body: JSON.stringify({ request: req }),
    });
  },
  grpcDescriptor(payload: {
    descriptor?: string;
    name?: string;
    target?: string;
    plaintext?: boolean;
    reflect?: boolean;
    metadata?: KeyValue[];
  }) {
    return request<GrpcDescriptorResult>("/grpc/descriptor", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  grpcCall(payload: {
    id: string;
    target: string;
    service: string;
    method: string;
    body: string;
    plaintext: boolean;
    metadata?: KeyValue[];
    timeoutMs?: number;
  }) {
    return request<GrpcResult>("/grpc/call", { method: "POST", body: JSON.stringify(payload) });
  },
  // grpcStream runs a server/client/bidi streaming RPC and forwards each event
  // (meta | message | status | error) to onEvent.
  async grpcStream(
    payload: {
      id: string;
      target: string;
      service: string;
      method: string;
      messages?: string[];
      body?: string;
      plaintext?: boolean;
      metadata?: KeyValue[];
    },
    onEvent: (ev: {
      type: string;
      response?: string;
      code?: string;
      message?: string;
      index?: number;
      duration?: number;
    }) => void,
    signal?: AbortSignal,
  ) {
    const res = await fetch("/api/grpc/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`grpc stream failed: HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of raw.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch {
            /* ignore */
          }
        }
      }
    }
  },
  listGrpcDescriptors() {
    return request<{ descriptors: GrpcStoredDescriptor[] }>("/grpc/descriptors");
  },
  deleteGrpcDescriptor(id: string) {
    return request<{ ok: boolean }>(`/grpc/descriptors/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  grpcExample(id: string, service: string, method: string) {
    return request<{ example: string }>("/grpc/example", {
      method: "POST",
      body: JSON.stringify({ id, service, method }),
    });
  },

  // OpenAPI / Swagger import
  parseOpenAPI(payload: { url?: string; content?: string; headers?: Record<string, string> }) {
    return request<OpenAPIResult>("/openapi/parse", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  importCollections(parentId: string, nodes: CollectionNode[]) {
    return request<{ collections: CollectionNode[]; count: number }>("/collections/import", {
      method: "POST",
      body: JSON.stringify({ parentId, nodes }),
    });
  },

  // Scheduler (delayed / periodic sends)
  createSchedule(payload: {
    name?: string;
    request: RequestDef;
    envId?: string;
    variables?: Record<string, string>;
    parents?: RequestDef[];
    mock?: boolean;
    delayMs?: number;
    startAt?: number;
    intervalMs?: number;
    count?: number;
  }) {
    return request<ScheduleJob>("/schedule", { method: "POST", body: JSON.stringify(payload) });
  },
  listSchedules() {
    return request<{ jobs: ScheduleJob[] }>("/schedule");
  },
  deleteSchedule(id: string) {
    return request<{ ok: boolean }>(`/schedule/${id}`, { method: "DELETE" });
  },
  runSchedule(id: string) {
    return request<{ ok: boolean }>(`/schedule/${id}/run`, { method: "POST" });
  },
  cancelSchedule(id: string) {
    return request<{ ok: boolean }>(`/schedule/${id}/cancel`, { method: "POST" });
  },
  scheduleResults(id: string) {
    return request<{ results: ScheduleResult[] }>(`/schedule/${id}/results`);
  },
  mockHits(id: string) {
    return request<{ count: number; lastAt: number; hits: MockHit[] }>(`/mock/${id}/hits`);
  },

  // Updates
  checkUpdate() {
    return request<{ current: string; latest: string; hasUpdate: boolean; url: string }>("/update/check");
  },
  applyUpdate() {
    return request<{ ok: boolean; updated: boolean; version: string; restartRequired?: boolean }>(
      "/update",
      { method: "POST" },
    );
  },

  // Concurrent batch runner
  runBatch(payload: {
    items: { name: string; request: RequestDef; repeat?: number }[];
    concurrency: number;
    envId?: string;
    variables?: Record<string, string>;
    mock?: boolean;
  }) {
    return request<{ results: BatchResult[]; summary: BatchSummary }>("/batch", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // Capture proxy
  listProxy() {
    return request<{
      running: boolean;
      addr: string;
      capture: boolean;
      ttlSeconds: number;
      filter: string;
      break: boolean;
      breakFilter: string;
      breakResponse: boolean;
      breakResponseFilter: string;
      mitm: boolean;
      mitmFilter: string;
      entries: CaptureEntry[];
    }>("/proxy");
  },
  proxyServer(enabled: boolean, addr: string) {
    return request<{ running: boolean; addr: string }>("/proxy/server", {
      method: "POST",
      body: JSON.stringify({ enabled, addr }),
    });
  },
  proxyConfig(payload: {
    capture: boolean;
    ttlSeconds: number;
    filter: string;
    break: boolean;
    breakFilter: string;
    breakResponse: boolean;
    breakResponseFilter: string;
    mitm: boolean;
    mitmFilter: string;
  }) {
    return request<{ ok: boolean }>("/proxy/config", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  saveCaptures(ids: string[], name?: string) {
    return request<{ count: number; folderId: string }>("/proxy/save", {
      method: "POST",
      body: JSON.stringify({ ids, name }),
    });
  },
  listIntercepts() {
    return request<{ pending: PendingIntercept[] }>("/intercept");
  },
  resolveIntercept(
    id: string,
    payload: {
      action: "continue" | "abort";
      method?: string;
      url?: string;
      status?: number;
      headers?: Record<string, string[]>;
      body?: string;
    },
  ) {
    return request<{ ok: boolean }>(`/intercept/${id}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  clearProxy() {
    return request<{ ok: boolean }>("/proxy", { method: "DELETE" });
  },
  replayProxy(id: string) {
    return request<CaptureEntry>(`/proxy/${id}/replay`, { method: "POST" });
  },

  // Fuzzing
  runFuzz(payload: {
    request: RequestDef;
    concurrency: number;
    payloads: string[];
    categories?: string[];
    kinds?: string[];
    maxCases?: number;
    envId?: string;
    variables?: Record<string, string>;
  }) {
    return request<FuzzResult>("/fuzz", { method: "POST", body: JSON.stringify(payload) });
  },

  // --- team / auth / projects ----------------------------------------------
  authStatus() {
    return request<AuthStatus>("/auth/status");
  },
  health() {
    return request<{ ok: boolean; variant: string; version: string; platform: string; features: Record<string, boolean> }>(
      "/health",
    );
  },

  // Feedback (via the gh CLI)
  feedbackStatus() {
    return request<{ available: boolean; repo: string }>("/feedback/status");
  },
  listFeedback() {
    return request<{ issues: FeedbackIssue[]; repo: string }>("/feedback/issues");
  },
  createFeedback(title: string, body: string) {
    return request<FeedbackIssue>("/feedback/issues", {
      method: "POST",
      body: JSON.stringify({ title, body }),
    });
  },
  getFeedback(number: number) {
    return request<FeedbackIssue>(`/feedback/issues/${number}`);
  },
  setFeedbackState(number: number, closed: boolean) {
    return request<FeedbackIssue>(`/feedback/issues/${number}/state`, {
      method: "POST",
      body: JSON.stringify({ closed }),
    });
  },
  commentFeedback(number: number, body: string) {
    return request<FeedbackIssue>(`/feedback/issues/${number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  },
  login(username: string, password: string) {
    return request<{
      token?: string;
      user?: User;
      totpRequired?: boolean;
      challenge?: string;
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },
  login2FA(challenge: string, code: string) {
    return request<{ token: string; user: User }>("/auth/login/2fa", {
      method: "POST",
      body: JSON.stringify({ challenge, code }),
    });
  },
  twoFASetup() {
    return request<{ secret: string; otpauth: string; recoveryCodes: string[] }>("/auth/2fa/setup", {
      method: "POST",
    });
  },
  twoFAEnable(code: string) {
    return request<{ enabled: boolean }>("/auth/2fa/enable", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  },
  twoFADisable(payload: { code?: string; password?: string }) {
    return request<{ enabled: boolean }>("/auth/2fa/disable", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  changePassword(current: string, next: string) {
    return request<{ ok: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current, new: next }),
    });
  },
  adminResetPassword(id: string) {
    return request<{ token: string; link: string; expiresIn: number }>(`/users/${id}/reset`, {
      method: "POST",
    });
  },
  bootstrap(username: string, password: string, name: string) {
    return request<{ token: string; user: User }>("/auth/bootstrap", {
      method: "POST",
      body: JSON.stringify({ username, password, name }),
    });
  },
  logout() {
    return request<{ ok: boolean }>("/auth/logout", { method: "POST" });
  },
  oidcConfig() {
    return request<{ enabled: boolean; label: string }>("/auth/oidc/config");
  },
  listAudit() {
    return request<{ entries: { id: string; at: string; user: string; action: string; target?: string; detail?: string }[] }>(
      "/audit",
    );
  },
  listUsers() {
    return request<{ users: User[] }>("/users");
  },
  createUser(payload: { username: string; password: string; name?: string; role?: string }) {
    return request<User>("/users", { method: "POST", body: JSON.stringify(payload) });
  },
  updateUser(id: string, payload: { name?: string; role?: string; password?: string }) {
    return request<User>(`/users/${id}`, { method: "PUT", body: JSON.stringify(payload) });
  },
  deleteUser(id: string) {
    return request<{ ok: boolean }>(`/users/${id}`, { method: "DELETE" });
  },
  listProjects() {
    return request<{ projects: Project[] }>("/projects");
  },
  createProject(name: string) {
    return request<Project>("/projects", { method: "POST", body: JSON.stringify({ name }) });
  },
  renameProject(id: string, name: string) {
    return request<{ ok: boolean }>(`/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    });
  },
  deleteProject(id: string) {
    return request<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" });
  },
  setMember(projectId: string, userId: string, role: string) {
    return request<{ ok: boolean }>(`/projects/${projectId}/members`, {
      method: "POST",
      body: JSON.stringify({ userId, role }),
    });
  },
  removeMember(projectId: string, userId: string) {
    return request<{ ok: boolean }>(`/projects/${projectId}/members/${userId}`, {
      method: "DELETE",
    });
  },
};
