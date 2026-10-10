import { create } from "zustand";
import { api } from "@/lib/api";
import {
  blankRequest,
  type ApiResponse,
  type CollectionNode,
  type Environment,
  type ExtractRule,
  type HistoryEntry,
  type KeyValue,
  type RequestDef,
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

  async loadAll() {
    await Promise.all([
      get().refreshCollections(),
      get().refreshHistory(),
      get().refreshEnvironments(),
    ]);
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
    if (!tab.request.url.trim()) {
      get().toast({ title: translate("urlRequiredToast"), variant: "error" });
      return;
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
