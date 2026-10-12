import { create } from "zustand";
import { api, setApiContext } from "@/lib/api";
import {
  blankRequest,
  type ApiResponse,
  type CollectionNode,
  type Environment,
  type ExtractRule,
  type HistoryEntry,
  type KeyValue,
  type Project,
  type RequestDef,
  type User,
} from "@/lib/types";
import { uid } from "@/lib/utils";
import { translate } from "@/lib/i18n";
import { browserSend } from "@/lib/browserClient";
import { evaluateAssertions } from "@/lib/browserAssert";

export type Tab = {
  id: string;
  name: string;
  request: RequestDef;
  sourceId?: string;
  response?: ApiResponse;
  sending: boolean;
  error?: string;
};

export type Toast = {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "success" | "error";
};

export type TestStatus = "pass" | "fail";

type State = {
  collections: CollectionNode[];
  history: HistoryEntry[];
  environments: Environment[];
  activeEnvId: string | null;
  selectedFolderId: string | null;

  tabs: Tab[];
  activeTabId: string | null;
  toasts: Toast[];
  // Responsive layout: the sidebar collapses to a drawer on small screens.
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  sidebarTab: string;
  setSidebarTab: (v: string) => void;
  sidebarWidth: number;
  setSidebarWidth: (v: number) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  rightOpen: boolean;
  setRightOpen: (v: boolean) => void;
  rightTab: string;
  setRightTab: (v: string) => void;
  rightWidth: number;
  setRightWidth: (v: number) => void;
  bottomOpen: boolean;
  setBottomOpen: (v: boolean) => void;
  bottomHeight: number;
  setBottomHeight: (v: number) => void;
  bottomMaximized: boolean;
  setBottomMaximized: (v: boolean) => void;
  feedbackOpen: boolean;
  setFeedbackOpen: (v: boolean) => void;
  feedbackHidden: boolean;
  setFeedbackHidden: (v: boolean) => void;
  feedbackPos: { x: number; y: number } | null;
  setFeedbackPos: (p: { x: number; y: number } | null) => void;
  aiConversations: AIConversation[];
  aiActiveId: string;
  aiPatchActive: (fn: (c: AIConversation) => AIConversation) => void;
  aiNewConversation: () => string;
  aiSelectConversation: (id: string) => void;
  aiDeleteConversation: (id: string) => void;
  aiPos: { x: number; y: number } | null;
  setAiPos: (p: { x: number; y: number } | null) => void;

  // team / auth / projects
  authEnabled: boolean;
  authenticated: boolean;
  user: User | null;
  userCount: number;
  projects: Project[];
  projectId: string;
  projectRole: string;
  projectVersion: number;
  loginOpen: boolean;
  // Build variant ("full" | "core") and which optional features are compiled in.
  buildVariant: string;
  version: string;
  platform: string;
  features: Record<string, boolean>;
  loadBuild: () => Promise<void>;
  setLoginOpen: (v: boolean) => void;
  loadAuth: () => Promise<void>;
  login: (username: string, password: string) => Promise<{ challenge?: string }>;
  login2FA: (challenge: string, code: string) => Promise<void>;
  bootstrap: (username: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  setProject: (id: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  syncProject: () => Promise<void>;
  // Per-collection-node test status (green/red indicator in the tree).
  testStatus: Record<string, TestStatus>;
  // Variables produced by hooks/parents, applied to subsequent sends.
  runtimeVars: Record<string, string>;

  // data loading
  loadAll: () => Promise<void>;
  refreshCollections: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  refreshEnvironments: () => Promise<void>;

  // toasts
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;

  // tabs
  newTab: (request?: RequestDef, sourceId?: string) => void;
  openNode: (node: CollectionNode) => void;
  openHistory: (entry: HistoryEntry) => void;
  openRequest: (request: RequestDef) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  applyRoute: () => void;
  updateActiveRequest: (patch: Partial<RequestDef>) => void;
  markSaved: (id: string, sourceId: string, name: string) => void;

  // executing
  send: (opts?: { mock?: boolean }) => Promise<void>;
  sendStream: (opts?: { lastEventId?: string; append?: boolean }) => Promise<void>;
  streamMode: boolean;
  setStreamMode: (v: boolean) => void;
  stopStream: () => void;
  autoReconnect: boolean;
  setAutoReconnect: (v: boolean) => void;

  // collections
  createFolder: (name: string, parentId?: string) => Promise<void>;
  createRequest: (name: string, parentId?: string, request?: RequestDef) => Promise<string | null>;
  saveActiveTab: (name?: string) => Promise<void>;
  renameNode: (id: string, name: string) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;
  moveNode: (id: string, parentId: string, siblingId?: string, position?: "before" | "after") => Promise<void>;
  duplicateNode: (id: string) => Promise<void>;
  updateFolder: (
    id: string,
    payload: { variables: KeyValue[]; setupNodeId: string; extract: ExtractRule[] },
  ) => Promise<void>;
  addDependency: (nodeId: string, parentNodeId: string) => Promise<void>;
  selectFolder: (id: string | null) => void;

  // history
  clearHistory: () => Promise<void>;
  deleteHistory: (id: string) => Promise<void>;

  // environments
  setActiveEnv: (id: string | null) => void;
  saveEnvironment: (env: Environment) => Promise<Environment | null>;
  deleteEnvironment: (id: string) => Promise<void>;
};

function findNode(nodes: CollectionNode[], id: string): CollectionNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

// --- deep-link routing (#/r/<uuid> for a request, #/f/<uuid> for a folder) ---

// isSmall reports whether we are on a phone-sized viewport (Tailwind `sm` = 640px).
function isSmall(): boolean {
  return typeof window !== "undefined" && window.innerWidth < 640;
}

function setHash(hash: string) {
  if (typeof window === "undefined") return;
  const next = hash && !hash.startsWith("#") ? "#" + hash : hash;
  if (window.location.hash === next) return;
  if (next) {
    window.location.hash = next;
  } else if (window.location.hash) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

function parseHash(): { type: "r" | "f"; id: string } | null {
  if (typeof window === "undefined") return null;
  const m = /^#\/(r|f)\/([^/?#]+)/.exec(window.location.hash);
  if (!m) return null;
  return { type: m[1] as "r" | "f", id: decodeURIComponent(m[2]) };
}

const ENV_STORAGE = "curlui.activeEnvId";

// normalizeRequest guarantees the arrays/objects the UI relies on exist,
// even when a request came from the backend with null fields (e.g. a parsed
// cURL command with no body form).
function normalizeRequest(r: RequestDef): RequestDef {
  const base = blankRequest();
  return {
    ...base,
    ...r,
    params: r.params ?? [],
    headers: r.headers ?? [],
    body: { ...base.body, ...(r.body ?? {}), form: r.body?.form ?? [] },
    auth: { ...base.auth, ...(r.auth ?? {}) },
    options: { ...base.options, ...(r.options ?? {}) },
    scripts: {
      pre: { ...base.scripts.pre, ...(r.scripts?.pre ?? {}) },
      post: { ...base.scripts.post, ...(r.scripts?.post ?? {}) },
    },
    dependsOn: r.dependsOn ?? [],
    extract: r.extract ?? [],
    assertions: r.assertions ?? [],
    mocks: r.mocks ?? [],
  };
}

// nodePath returns the chain of nodes from the root down to (and including)
// the node with the given id.
function nodePath(nodes: CollectionNode[], id: string): CollectionNode[] {
  for (const n of nodes) {
    if (n.id === id) return [n];
    const sub = nodePath(n.children ?? [], id);
    if (sub.length) return [n, ...sub];
  }
  return [];
}

// dependsOnClosure returns every node id that the given request depends on,
// transitively (used for cycle detection).
function dependsOnClosure(
  collections: CollectionNode[],
  id: string,
  seen: Set<string> = new Set(),
): Set<string> {
  const node = findNode(collections, id);
  if (!node || node.type !== "request" || !node.request) return seen;
  for (const dep of node.request.dependsOn ?? []) {
    if (seen.has(dep)) continue;
    seen.add(dep);
    dependsOnClosure(collections, dep, seen);
  }
  return seen;
}

export type Chain = { parents: RequestDef[]; folderVars: Record<string, string> };

// buildChain resolves the full execution hierarchy for a request: ancestor
// folder variables, ancestor folder setup requests, and explicit dependsOn
// parents (each parent's own dependencies first).
export function buildChain(
  collections: CollectionNode[],
  targetNodeId: string,
  req: RequestDef,
): Chain {
  const parents: RequestDef[] = [];
  const folderVars: Record<string, string> = {};
  const visited = new Set<string>();

  const addParents = (ids: string[]) => {
    for (const id of ids) {
      if (visited.has(id)) continue;
      visited.add(id);
      const node = findNode(collections, id);
      if (!node || node.type !== "request" || !node.request) continue;
      const parentReq = normalizeRequest(node.request);
      addParents(parentReq.dependsOn ?? []);
      parents.push({ ...parentReq, name: node.name });
    }
  };

  if (targetNodeId) {
    const path = nodePath(collections, targetNodeId);
    for (const folder of path.filter((n) => n.type === "folder")) {
      for (const v of folder.variables ?? []) {
        if (v.enabled && v.key) folderVars[v.key] = v.value;
      }
      if (!folder.setupNodeId || visited.has(folder.setupNodeId)) continue;
      const setup = findNode(collections, folder.setupNodeId);
      if (!setup || setup.type !== "request" || !setup.request) continue;
      visited.add(setup.id);
      const setupReq = normalizeRequest(setup.request);
      addParents(setupReq.dependsOn ?? []);
      parents.push({
        ...setupReq,
        name: `${folder.name} · ${setup.name}`,
        extract: [...(setupReq.extract ?? []), ...(folder.extract ?? [])],
      });
    }
  }

  addParents(req.dependsOn ?? []);
  return { parents, folderVars };
}

// computeStatus derives the green/red indicator from assertions and hook tests.
let streamController: AbortController | null = null;
let streamReconnectTimer: ReturnType<typeof setTimeout> | null = null;

// lastEventID returns the id of the last SSE event in a body (for resumption).
function lastEventID(body: string): string {
  let id = "";
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("id:")) id = line.slice(3).trim();
  }
  return id;
}

// AIMessage is one turn of the assistant conversation.
export type AIMessage = {
  role: "user" | "assistant";
  text: string;
  tools: { name: string; args?: unknown }[];
  error?: string;
};

// AIConversation is one thread with the assistant.
export type AIConversation = {
  id: string;
  title: string;
  sessionId: string;
  messages: AIMessage[];
  updatedAt: number;
};

const AI_STORE_KEY = "curlui.aiConversations";
const MAX_CONVERSATIONS = 20;

function newConversation(): AIConversation {
  return {
    id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "",
    sessionId: "",
    messages: [],
    updatedAt: Date.now(),
  };
}

function readConversations(): { list: AIConversation[]; active: string } {
  try {
    const raw = localStorage.getItem(AI_STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { list?: AIConversation[]; active?: string };
      const list = Array.isArray(parsed.list) ? parsed.list.filter((c) => c && c.id) : [];
      if (list.length) {
        const active = list.some((c) => c.id === parsed.active) ? parsed.active! : list[0].id;
        return { list, active };
      }
    }
  } catch {
    /* fall through to a fresh conversation */
  }
  const conv = newConversation();
  return { list: [conv], active: conv.id };
}

function writeConversations(list: AIConversation[], active: string) {
  try {
    localStorage.setItem(
      AI_STORE_KEY,
      JSON.stringify({ list: list.slice(0, MAX_CONVERSATIONS), active }),
    );
  } catch {
    /* quota exceeded — keep it in memory only */
  }
}

function computeStatus(res: ApiResponse): TestStatus | undefined {
  const assertions = res.assertions ?? [];
  const hookTests = (res.hooks ?? []).flatMap((h) => h.tests ?? []);
  const all = [...assertions, ...hookTests];
  const hookError = (res.hooks ?? []).some((h) => !!h.error);
  if (all.length === 0) {
    return res.error || hookError ? "fail" : undefined;
  }
  return all.every((t) => t.passed) && !res.error && !hookError ? "pass" : "fail";
}

export const useStore = create<State>((set, get) => ({
  collections: [],
  history: [],
  environments: [],
  activeEnvId: typeof localStorage !== "undefined" ? localStorage.getItem(ENV_STORAGE) : null,
  selectedFolderId: null,
  tabs: [],
  activeTabId: null,
  toasts: [],
  sidebarOpen: typeof window !== "undefined" ? window.innerWidth >= 768 : true,
  testStatus: {},
  runtimeVars: {},

  authEnabled: false,
  authenticated: true,
  user: null,
  userCount: 0,
  projects: [],
  projectId: typeof localStorage !== "undefined" ? localStorage.getItem("curlui.project") ?? "local" : "local",
  projectRole: "member",
  projectVersion: 0,
  loginOpen: false,
  buildVariant: "full",
  version: "",
  platform: "",
  features: {},

  async loadBuild() {
    try {
      const h = await api.health();
      set({ buildVariant: h.variant || "full", version: h.version || "", platform: h.platform || "", features: h.features ?? {} });
    } catch {
      /* keep defaults (assume full) */
    }
  },

  setLoginOpen(v) {
    set({ loginOpen: v });
  },

  async loadAuth() {
    try {
      const st = await api.authStatus();
      setApiContext({ project: st.project });
      set({
        authEnabled: st.authEnabled,
        authenticated: st.authenticated,
        user: st.user,
        userCount: st.userCount,
        projects: st.projects ?? [],
        projectId: st.project,
        projectRole: st.role,
      });
    } catch {
      set({ authEnabled: true, authenticated: false, user: null });
    }
  },

  async login(username, password) {
    const r = await api.login(username, password);
    // With 2FA on, the password step returns a challenge to complete.
    if (r.totpRequired && r.challenge) return { challenge: r.challenge };
    setApiContext({ token: r.token });
    await get().loadAuth();
    await get().loadAll();
    return {};
  },
  async login2FA(challenge, code) {
    const r = await api.login2FA(challenge, code);
    setApiContext({ token: r.token });
    await get().loadAuth();
    await get().loadAll();
  },

  async bootstrap(username, password, name) {
    const r = await api.bootstrap(username, password, name);
    setApiContext({ token: r.token });
    await get().loadAuth();
    await get().loadAll();
  },

  async logout() {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setApiContext({ token: "" });
    set({ authenticated: false, user: null, tabs: [], activeTabId: null });
  },

  async setProject(id) {
    if (!id) return;
    setApiContext({ project: id });
    set({ projectId: id, collections: [], history: [], environments: [], tabs: [], activeTabId: null });
    await get().loadAll();
  },

  async refreshProjects() {
    try {
      const { projects } = await api.listProjects();
      set({ projects: projects ?? [] });
    } catch {
      /* ignore */
    }
  },

  async createProject(name) {
    const p = await api.createProject(name);
    await get().refreshProjects();
    await get().setProject(p.id);
  },

  // syncProject polls the project version and refreshes when a teammate
  // changed the shared workspace.
  async syncProject() {
    try {
      const { projects } = await api.listProjects();
      const current = projects?.find((p) => p.id === get().projectId);
      set({ projects: projects ?? [] });
      if (current && (current.version ?? 0) !== get().projectVersion) {
        set({ projectVersion: current.version ?? 0 });
        await Promise.all([
          get().refreshCollections(),
          get().refreshHistory(),
          get().refreshEnvironments(),
        ]);
      }
    } catch {
      /* ignore */
    }
  },

  async loadAll() {
    await get().loadBuild();
    await get().loadAuth();
    if (get().authEnabled && !get().authenticated) return;
    // Collections are needed for the first paint; history and environments are
    // other tabs, so load them in the background.
    await get().refreshCollections();
    void get().refreshHistory();
    void get().refreshEnvironments();
  },

  async refreshCollections() {
    const { collections } = await api.listCollections();
    set({ collections: collections ?? [] });
  },

  async refreshHistory() {
    const { history } = await api.listHistory();
    set({ history: history ?? [] });
  },

  async refreshEnvironments() {
    const { environments } = await api.listEnvironments();
    set({ environments: environments ?? [] });
    const active = get().activeEnvId;
    if (active && !environments.some((e) => e.id === active)) {
      set({ activeEnvId: null });
      localStorage.removeItem(ENV_STORAGE);
    }
  },

  toast(t) {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), 3800);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  newTab(request, sourceId) {
    const req = normalizeRequest(request ?? blankRequest());
    const name = req.name || "Untitled request";
    // Phones handle one request at a time: reuse the active tab.
    if (isSmall() && get().tabs.length > 0) {
      const activeId = get().activeTabId ?? get().tabs[0].id;
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === activeId
            ? { ...t, name, request: req, sourceId, response: undefined, error: undefined, sending: false }
            : t,
        ),
        activeTabId: activeId,
      }));
      setHash(sourceId ? `#/r/${sourceId}` : "");
      return;
    }
    const tab: Tab = {
      id: uid(),
      name,
      request: req,
      sourceId,
      sending: false,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
    setHash(sourceId ? `#/r/${sourceId}` : "");
  },

  openNode(node) {
    if (node.type !== "request" || !node.request) return;
    if (typeof window !== "undefined" && window.innerWidth < 768) set({ sidebarOpen: false });
    const existing = get().tabs.find((t) => t.sourceId === node.id);
    if (existing) {
      get().setActiveTab(existing.id);
      return;
    }
    const req = normalizeRequest({ ...node.request, name: node.name });
    get().newTab(req, node.id);
  },

  applyRoute() {
    const route = parseHash();
    if (!route) return;
    const node = findNode(get().collections, route.id);
    if (!node) return;
    if (route.type === "r" && node.type === "request") {
      get().openNode(node);
    } else if (route.type === "f" && node.type === "folder") {
      set({ selectedFolderId: node.id });
    }
  },

  openHistory(entry) {
    if (typeof window !== "undefined" && window.innerWidth < 768) set({ sidebarOpen: false });
    get().newTab(
      normalizeRequest({
        ...entry.request,
        name: `History · ${entry.request.method} ${entry.request.url}`,
      }),
    );
  },

  openRequest(request) {
    get().newTab(normalizeRequest(request));
  },

  closeTab(id) {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      let activeTabId = s.activeTabId;
      if (activeTabId === id) {
        const idx = s.tabs.findIndex((t) => t.id === id);
        activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
      }
      const active = tabs.find((t) => t.id === activeTabId);
      setTimeout(() => setHash(active?.sourceId ? `#/r/${active.sourceId}` : ""), 0);
      return { tabs, activeTabId };
    });
  },

  setActiveTab(id) {
    const tab = get().tabs.find((t) => t.id === id);
    set({ activeTabId: id });
    setHash(tab?.sourceId ? `#/r/${tab.sourceId}` : "");
  },

  setSidebarOpen(v) {
    set({ sidebarOpen: v });
  },
  sidebarTab: "collections",
  setSidebarTab(v) {
    set({ sidebarTab: v });
  },
  sidebarWidth: Number(localStorage.getItem("curlui.sidebarWidth")) || 320,
  setSidebarWidth(v) {
    const w = Math.min(Math.max(v, 240), 560);
    localStorage.setItem("curlui.sidebarWidth", String(w));
    set({ sidebarWidth: w });
  },
  sidebarCollapsed: localStorage.getItem("curlui.sidebarCollapsed") === "1",
  setSidebarCollapsed(v) {
    localStorage.setItem("curlui.sidebarCollapsed", v ? "1" : "0");
    set({ sidebarCollapsed: v });
  },
  rightOpen: (() => {
    const saved = localStorage.getItem("curlui.rightOpen");
    if (saved === "0") return false;
    if (saved === "1") return true;
    // Default: open on desktop, closed on phones/tablets.
    return typeof window !== "undefined" ? window.innerWidth >= 1024 : true;
  })(),
  setRightOpen(v) {
    localStorage.setItem("curlui.rightOpen", v ? "1" : "0");
    set({ rightOpen: v });
  },
  rightTab: "history",
  setRightTab(v) {
    // Selecting a tab also opens the sidebar.
    set({ rightTab: v, rightOpen: true });
  },
  rightWidth: Number(localStorage.getItem("curlui.rightWidth")) || 340,
  setRightWidth(v) {
    const w = Math.min(Math.max(v, 240), 560);
    localStorage.setItem("curlui.rightWidth", String(w));
    set({ rightWidth: w });
  },
  bottomOpen: localStorage.getItem("curlui.bottomOpen") === "1",
  setBottomOpen(v) {
    localStorage.setItem("curlui.bottomOpen", v ? "1" : "0");
    set({ bottomOpen: v });
  },
  bottomHeight: Number(localStorage.getItem("curlui.bottomHeight")) || 280,
  setBottomHeight(v) {
    const h = Math.min(Math.max(v, 120), 760);
    localStorage.setItem("curlui.bottomHeight", String(h));
    set({ bottomHeight: h });
  },
  bottomMaximized: localStorage.getItem("curlui.bottomMaximized") === "1",
  setBottomMaximized(v) {
    localStorage.setItem("curlui.bottomMaximized", v ? "1" : "0");
    set({ bottomMaximized: v });
  },
  feedbackOpen: false,
  setFeedbackOpen(v) {
    set({ feedbackOpen: v });
  },
  feedbackHidden: localStorage.getItem("curlui.feedbackHidden") === "1",
  streamMode: localStorage.getItem("curlui.streamMode") === "1",
  setStreamMode(v) {
    localStorage.setItem("curlui.streamMode", v ? "1" : "0");
    set({ streamMode: v });
  },
  autoReconnect: localStorage.getItem("curlui.autoReconnect") === "1",
  setAutoReconnect(v) {
    localStorage.setItem("curlui.autoReconnect", v ? "1" : "0");
    set({ autoReconnect: v });
  },
  stopStream() {
    if (streamReconnectTimer) clearTimeout(streamReconnectTimer);
    streamReconnectTimer = null;
    streamController?.abort();
    streamController = null;
  },
  setFeedbackHidden(v) {
    localStorage.setItem("curlui.feedbackHidden", v ? "1" : "0");
    set({ feedbackHidden: v, feedbackOpen: false });
  },
  // Conversations live in the store so closing the panel (which unmounts it)
  // does not throw them away, and in localStorage so they survive a reload.
  // Several threads can be kept side by side.
  aiConversations: readConversations().list,
  aiActiveId: readConversations().active,
  aiPatchActive(fn) {
    set((s) => {
      const list = s.aiConversations.map((c) => (c.id === s.aiActiveId ? fn(c) : c));
      writeConversations(list, s.aiActiveId);
      return { aiConversations: list };
    });
  },
  aiNewConversation() {
    const conv = newConversation();
    set((s) => {
      const list = [conv, ...s.aiConversations].slice(0, MAX_CONVERSATIONS);
      writeConversations(list, conv.id);
      return { aiConversations: list, aiActiveId: conv.id };
    });
    return conv.id;
  },
  aiSelectConversation(id) {
    set((s) => {
      if (!s.aiConversations.some((c) => c.id === id)) return {};
      writeConversations(s.aiConversations, id);
      return { aiActiveId: id };
    });
  },
  aiDeleteConversation(id) {
    set((s) => {
      const list = s.aiConversations.filter((c) => c.id !== id);
      const next = list.length ? list : [newConversation()];
      const active = s.aiActiveId === id ? next[0].id : s.aiActiveId;
      writeConversations(next, active);
      return { aiConversations: next, aiActiveId: active };
    });
  },
  aiPos: (() => {
    try {
      const raw = localStorage.getItem("curlui.aiPos");
      return raw ? (JSON.parse(raw) as { x: number; y: number }) : null;
    } catch {
      return null;
    }
  })(),
  setAiPos(p) {
    if (p) localStorage.setItem("curlui.aiPos", JSON.stringify(p));
    else localStorage.removeItem("curlui.aiPos");
    set({ aiPos: p });
  },
  feedbackPos: (() => {
    try {
      const raw = localStorage.getItem("curlui.feedbackPos");
      return raw ? (JSON.parse(raw) as { x: number; y: number }) : null;
    } catch {
      return null;
    }
  })(),
  setFeedbackPos(p) {
    if (p) localStorage.setItem("curlui.feedbackPos", JSON.stringify(p));
    else localStorage.removeItem("curlui.feedbackPos");
    set({ feedbackPos: p });
  },

  renameTab(id, name) {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, name, request: { ...t.request, name } } : t,
      ),
    }));
  },

  updateActiveRequest(patch) {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, request: { ...t.request, ...patch } } : t,
      ),
    }));
  },

  markSaved(id, sourceId, name) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, sourceId, name } : t)),
    }));
    if (get().activeTabId === id) setHash(`#/r/${sourceId}`);
  },

  async send(opts) {
    const { tabs, activeTabId, activeEnvId, environments } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    if (tab.request.protocol !== "grpc" && !tab.request.url.trim()) {
      get().toast({ title: translate("urlRequiredToast"), variant: "error" });
      return;
    }
    if (
      get().streamMode &&
      tab.request.protocol !== "grpc" &&
      !opts?.mock &&
      tab.request.options.sendVia !== "browser"
    ) {
      return get().sendStream();
    }
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, sending: true, error: undefined } : t)),
    }));
    try {
      if (tab.request.options.sendVia === "browser") {
        // Send straight from the browser (resolves variables client-side).
        const chain = buildChain(get().collections, tab.sourceId ?? "", tab.request);
        const env = environments.find((e) => e.id === activeEnvId);
        const envVars: Record<string, string> = {};
        for (const v of env?.variables ?? []) if (v.enabled && v.key) envVars[v.key] = v.value;
        const response = await browserSend(tab.request, {
          ...envVars,
          ...chain.folderVars,
          ...get().runtimeVars,
        });
        response.assertions = evaluateAssertions(response, tab.request.assertions ?? []);
        const status = computeStatus(response);
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tab.id ? { ...t, sending: false, response, error: response.error } : t,
          ),
          testStatus:
            status && tab.sourceId
              ? { ...s.testStatus, [tab.sourceId]: status }
              : s.testStatus,
        }));
        get().refreshHistory();
        return;
      }

      const chain = buildChain(get().collections, tab.sourceId ?? "", tab.request);
      const variables = { ...chain.folderVars, ...get().runtimeVars };
      const { response } = await api.send(
        tab.request,
        activeEnvId,
        variables,
        chain.parents,
        opts?.mock ?? false,
      );
      const status = computeStatus(response);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tab.id ? { ...t, sending: false, response, error: response.error } : t,
        ),
        testStatus:
          status && tab.sourceId
            ? { ...s.testStatus, [tab.sourceId]: status }
            : s.testStatus,
      }));
      const hookVars: Record<string, string> = {};
      for (const hook of response.hooks ?? []) Object.assign(hookVars, hook.variables ?? {});
      if (Object.keys(hookVars).length) {
        set((s) => ({ runtimeVars: { ...s.runtimeVars, ...hookVars } }));
      }
      get().refreshHistory();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, sending: false, error: message } : t)),
      }));
      get().toast({ title: translate("requestFailed"), description: message, variant: "error" });
    }
  },

  // sendStream runs the request server-side and renders the body as it arrives.
  // With auto-reconnect it resumes an SSE source using Last-Event-ID.
  async sendStream(opts) {
    const { tabs, activeTabId, activeEnvId } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    if (!tab.request.url.trim()) {
      get().toast({ title: translate("urlRequiredToast"), variant: "error" });
      return;
    }
    const chain = buildChain(get().collections, tab.sourceId ?? "", tab.request);
    const variables = { ...chain.folderVars, ...get().runtimeVars };
    const prior = opts?.append ? tab.response : undefined;
    const partial: ApiResponse = prior
      ? { ...prior }
      : {
          status: 0,
          statusText: "",
          headers: {},
          cookies: [],
          body: "",
          contentType: "",
          isBinary: false,
          size: 0,
          duration: 0,
          timing: { dns: 0, connect: 0, tls: 0, firstByte: 0, total: 0 },
          request: { method: tab.request.method, url: tab.request.url, headers: {}, body: "" },
          chunks: [],
        };
    if (!partial.chunks) partial.chunks = [];
    const push = () =>
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, response: { ...partial } } : t)),
      }));
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tab.id ? { ...t, sending: true, error: undefined, response: { ...partial } } : t,
      ),
    }));
    const controller = new AbortController();
    streamController = controller;
    try {
      await api.stream(
        tab.request,
        activeEnvId,
        variables,
        chain.parents,
        (ev) => {
          if (ev.type === "meta") {
            partial.status = ev.data.status ?? 0;
            partial.statusText = ev.data.statusText ?? "";
            partial.headers = ev.data.headers ?? {};
            partial.contentType = ev.data.contentType ?? "";
            partial.request = ev.data.request ?? partial.request;
            partial.timing = ev.data.timing ?? partial.timing;
            partial.duration = ev.data.timing?.total ?? 0;
          } else if (ev.type === "chunk") {
            partial.body += ev.data.text ?? "";
            partial.size = ev.data.size ?? partial.body.length;
            partial.chunks!.push({ size: partial.size, at: ev.data.at ?? 0 });
          } else if (ev.type === "done") {
            if (typeof ev.data?.duration === "number") partial.duration = ev.data.duration;
          } else if (ev.type === "error") {
            partial.error = ev.data?.error ?? "stream error";
          }
          push();
        },
        controller.signal,
        opts?.lastEventId,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("abort")) {
        partial.statusText = partial.statusText || "cancelled";
      } else {
        partial.error = message;
      }
    } finally {
      if (streamController === controller) streamController = null;
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, sending: false, error: partial.error } : t)),
      }));
      get().refreshHistory();
      // SSE auto-reconnect: resume from the last event id.
      const isSSE = (partial.contentType || "").toLowerCase().includes("text/event-stream");
      if (get().autoReconnect && isSSE && !partial.error && !controller.signal.aborted) {
        const id = lastEventID(partial.body);
        streamReconnectTimer = setTimeout(() => {
          streamReconnectTimer = null;
          void get().sendStream({ lastEventId: id, append: true });
        }, 3000);
      }
    }
  },

  async createFolder(name, parentId) {
    try {
      await api.createNode({ parentId: parentId ?? "", type: "folder", name });
      await get().refreshCollections();
      get().toast({ title: translate("folderCreated"), variant: "success" });
    } catch (err) {
      get().toast({ title: translate("couldNotCreateFolder"), description: String(err), variant: "error" });
    }
  },

  async createRequest(name, parentId, request) {
    try {
      const node = await api.createNode({
        parentId: parentId ?? "",
        type: "request",
        name,
        request: request ?? blankRequest(),
      });
      await get().refreshCollections();
      return node.id;
    } catch (err) {
      get().toast({ title: translate("couldNotSave"), description: String(err), variant: "error" });
      return null;
    }
  },

  async saveActiveTab(name) {
    const { tabs, activeTabId, selectedFolderId } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    const finalName = name ?? tab.name ?? "Untitled request";
    try {
      if (tab.sourceId) {
        await api.updateNode(tab.sourceId, { name: finalName, request: tab.request });
        get().markSaved(tab.id, tab.sourceId, finalName);
      } else {
        const node = await api.createNode({
          parentId: selectedFolderId ?? "",
          type: "request",
          name: finalName,
          request: tab.request,
        });
        get().markSaved(tab.id, node.id, finalName);
      }
      await get().refreshCollections();
      get().toast({ title: translate("requestSaved"), variant: "success" });
    } catch (err) {
      get().toast({ title: translate("saveFailed"), description: String(err), variant: "error" });
    }
  },

  async renameNode(id, name) {
    try {
      await api.updateNode(id, { name });
      await get().refreshCollections();
    } catch (err) {
      get().toast({ title: translate("renameFailed"), description: String(err), variant: "error" });
    }
  },

  async deleteNode(id) {
    try {
      await api.deleteNode(id);
      await get().refreshCollections();
      get().toast({ title: translate("deleted"), variant: "success" });
    } catch (err) {
      get().toast({ title: translate("deleteFailed"), description: String(err), variant: "error" });
    }
  },

  async moveNode(id, parentId, siblingId, position) {
    try {
      await api.moveNode(id, parentId, siblingId ?? "", position ?? "after");
      await get().refreshCollections();
    } catch (err) {
      get().toast({ title: translate("moveFailed"), description: String(err), variant: "error" });
    }
  },

  async duplicateNode(id) {
    try {
      await api.duplicateNode(id);
      await get().refreshCollections();
      get().toast({ title: translate("duplicated"), variant: "success" });
    } catch (err) {
      get().toast({ title: translate("deleteFailed"), description: String(err), variant: "error" });
    }
  },

  async updateFolder(id, payload) {
    try {
      await api.updateFolder(id, payload);
      await get().refreshCollections();
      get().toast({ title: translate("folderSaved"), variant: "success" });
    } catch (err) {
      get().toast({ title: translate("saveFailed"), description: String(err), variant: "error" });
    }
  },

  async addDependency(nodeId, parentNodeId) {
    const { collections } = get();
    const node = findNode(collections, nodeId);
    const parent = findNode(collections, parentNodeId);
    if (!node || node.type !== "request" || !node.request) return;
    if (!parent || parent.type !== "request") return;
    if (dependsOnClosure(collections, parentNodeId).has(nodeId)) {
      get().toast({ title: translate("dependencyCycle"), variant: "error" });
      return;
    }
    const current = node.request.dependsOn ?? [];
    if (!current.includes(parentNodeId)) {
      const request = {
        ...normalizeRequest(node.request),
        dependsOn: [...current, parentNodeId],
      };
      try {
        await api.updateNode(nodeId, { request });
        await get().refreshCollections();
      } catch (err) {
        get().toast({ title: translate("saveFailed"), description: String(err), variant: "error" });
        return;
      }
    }
    get().toast({ title: translate("dependencyAdded"), variant: "success" });
  },

  selectFolder(id) {
    set({ selectedFolderId: id });
    setHash(id ? `#/f/${id}` : "");
  },
  async clearHistory() {
    try {
      await api.clearHistory();
      set({ history: [] });
    } catch (err) {
      get().toast({ title: translate("couldNotClearHistory"), description: String(err), variant: "error" });
    }
  },

  async deleteHistory(id) {
    try {
      await api.deleteHistory(id);
      set((s) => ({ history: s.history.filter((h) => h.id !== id) }));
    } catch {
      /* ignore */
    }
  },

  setActiveEnv(id) {
    set({ activeEnvId: id });
    if (id) localStorage.setItem(ENV_STORAGE, id);
    else localStorage.removeItem(ENV_STORAGE);
  },

  async saveEnvironment(env) {
    try {
      const saved = await api.saveEnvironment(env);
      await get().refreshEnvironments();
      get().toast({ title: translate("envSaved"), variant: "success" });
      return saved;
    } catch (err) {
      get().toast({ title: translate("saveFailed"), description: String(err), variant: "error" });
      return null;
    }
  },

  async deleteEnvironment(id) {
    try {
      await api.deleteEnvironment(id);
      if (get().activeEnvId === id) get().setActiveEnv(null);
      await get().refreshEnvironments();
    } catch (err) {
      get().toast({ title: translate("deleteFailed"), description: String(err), variant: "error" });
    }
  },
}));

export function useActiveTab(): Tab | undefined {
  return useStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
}

export { findNode };
