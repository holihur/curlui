import type {
  ApiResponse,
  CollectionNode,
  Environment,
  ExtractRule,
  HistoryEntry,
  KeyValue,
  OpenAPIResult,
  RequestDef,
  ScheduleJob,
  ScheduleResult,
} from "./types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
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
};
