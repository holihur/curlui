export type KeyValue = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
  type?: "text" | "file";
  filePath?: string;
};

export type BodyType =
  | "none"
  | "json"
  | "text"
  | "xml"
  | "html"
  | "form-urlencoded"
  | "form-data"
  | "binary";

export type Body = {
  type: BodyType;
  raw: string;
  form: KeyValue[];
  filePath?: string;
};

export type AuthType = "none" | "basic" | "bearer" | "apikey";

export type Auth = {
  type: AuthType;
  username?: string;
  password?: string;
  token?: string;
  key?: string;
  value?: string;
  addTo?: "header" | "query";
};

export type RequestOptions = {
  timeout: number;
  followRedirects: boolean;
  verifyTLS: boolean;
  proxy?: string;
  maxRedirects?: number;
};

export type RequestDef = {
  id: string;
  name: string;
  method: string;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: Body;
  auth: Auth;
  options: RequestOptions;
};

export type Environment = {
  id: string;
  name: string;
  variables: KeyValue[];
};

export type CollectionNode = {
  id: string;
  type: "folder" | "request";
  name: string;
  request?: RequestDef;
  children?: CollectionNode[];
};

export type HistoryEntry = {
  id: string;
  request: RequestDef;
  status: number;
  statusText: string;
  duration: number;
  size: number;
  error?: string;
  envId?: string;
  createdAt: number;
};

export type Timing = {
  dns: number;
  connect: number;
  tls: number;
  firstByte: number;
  total: number;
};

export type ResponseCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: string;
  httpOnly: boolean;
  secure: boolean;
};

export type SentRequest = {
  method: string;
  url: string;
  headers: Record<string, string[]>;
  body: string;
};

export type ApiResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string[]>;
  cookies: ResponseCookie[] | null;
  body: string;
  bodyBase64?: string;
  contentType: string;
  isBinary: boolean;
  size: number;
  duration: number;
  timing: Timing;
  request: SentRequest;
  error?: string;
};

export const blankRequest = (): RequestDef => ({
  id: "",
  name: "Untitled request",
  method: "GET",
  url: "",
  params: [],
  headers: [],
  body: { type: "none", raw: "", form: [] },
  auth: { type: "none", addTo: "header" },
  options: { timeout: 30000, followRedirects: true, verifyTLS: true, maxRedirects: 10 },
});

export const emptyKV = (): KeyValue => ({
  id: Math.random().toString(36).slice(2),
  key: "",
  value: "",
  enabled: true,
  type: "text",
});

export type OpenAPIResult = {
  title: string;
  version: string;
  baseUrl: string;
  specType: "swagger2" | "openapi3";
  endpoints: number;
  collections: CollectionNode[];
};
