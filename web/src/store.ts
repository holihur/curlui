import { create } from "zustand";
import { api } from "@/lib/api";
import {
  blankRequest,
  type ApiResponse,
  type CollectionNode,
  type Environment,
  type HistoryEntry,
  type RequestDef,
} from "@/lib/types";
import { uid } from "@/lib/utils";
import { translate } from "@/lib/i18n";

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
  updateActiveRequest: (patch: Partial<RequestDef>) => void;
  markSaved: (id: string, sourceId: string, name: string) => void;

  // executing
  send: () => Promise<void>;

  // collections
  createFolder: (name: string, parentId?: string) => Promise<void>;
  createRequest: (name: string, parentId?: string, request?: RequestDef) => Promise<string | null>;
  saveActiveTab: (name?: string) => Promise<void>;
  renameNode: (id: string, name: string) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;
  moveNode: (id: string, parentId: string) => Promise<void>;
  duplicateNode: (id: string) => Promise<void>;
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
  };
}

// collectParents resolves dependency node IDs into an ordered list of parent
// requests (each parent's own dependencies first).
function collectParents(
  nodes: CollectionNode[],
  ids: string[],
  visited: Set<string> = new Set(),
): RequestDef[] {
  const out: RequestDef[] = [];
  for (const id of ids) {
    if (visited.has(id)) continue;
    visited.add(id);
    const node = findNode(nodes, id);
    if (!node || node.type !== "request" || !node.request) continue;
    const req = normalizeRequest(node.request);
    out.push(...collectParents(nodes, req.dependsOn ?? [], visited));
    out.push({ ...req, name: node.name });
  }
  return out;
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
  testStatus: {},
  runtimeVars: {},

  async loadAll() {
    await Promise.all([
      get().refreshCollections(),
      get().refreshHistory(),
      get().refreshEnvironments(),
    ]);
    // Open a blank request if nothing is open.
    if (get().tabs.length === 0) {
      get().newTab();
    }
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
    const tab: Tab = {
      id: uid(),
      name: req.name || "Untitled request",
      request: req,
      sourceId,
      sending: false,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  openNode(node) {
    if (node.type !== "request" || !node.request) return;
    const existing = get().tabs.find((t) => t.sourceId === node.id);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const req = normalizeRequest({ ...node.request, name: node.name });
    get().newTab(req, node.id);
  },

  openHistory(entry) {
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
      return { tabs, activeTabId };
    });
  },

  setActiveTab(id) {
    set({ activeTabId: id });
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
  },

  async send() {
    const { tabs, activeTabId, activeEnvId } = get();
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
      const parents = collectParents(get().collections, tab.request.dependsOn ?? []);
      const { response } = await api.send(
        tab.request,
        activeEnvId,
        get().runtimeVars,
        parents,
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

  async moveNode(id, parentId) {
    try {
      await api.moveNode(id, parentId);
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

  selectFolder(id) {
    set({ selectedFolderId: id });
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
