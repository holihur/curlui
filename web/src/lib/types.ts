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
  | "binary"
  | "graphql";

export type Body = {
  type: BodyType;
  raw: string;
  form: KeyValue[];
  filePath?: string;
  query?: string;
  variables?: string;
  operationName?: string;
};

export type AuthType = "none" | "basic" | "bearer" | "apikey" | "oauth2" | "jwt" | "aws" | "digest";

export type Auth = {
  type: AuthType;
  username?: string;
  password?: string;
  token?: string;
  key?: string;
  value?: string;
  addTo?: "header" | "query";
  // oauth2
  grantType?: string;
  tokenUrl?: string;
  authUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  refreshToken?: string;
  clientAuth?: "basic" | "body";
  // jwt
  jwtAlg?: string;
  jwtSecret?: string;
  jwtClaims?: string;
  // aws sigv4
  awsAccessKey?: string;
  awsSecretKey?: string;
  awsRegion?: string;
  awsService?: string;
  awsSessionToken?: string;
};

export type RequestOptions = {
  timeout: number;
  followRedirects: boolean;
  verifyTLS: boolean;
  proxy?: string;
  maxRedirects?: number;
  sendVia?: "server" | "browser";
  useCookieJar?: boolean;
  clientCert?: string;
  clientKey?: string;
};

export type MockResponse = {
  id: string;
  name: string;
  enabled: boolean;
  status: number;
  headers: KeyValue[];
  body: string;
  delayMs: number;
};

export type ScheduleJob = {
  id: string;
  name: string;
  request: RequestDef;
  envId?: string;
  runs: number;
  lastStatus: number;
  lastError?: string;
  lastRun?: number;
  nextRun?: number;
  active: boolean;
  intervalMs?: number;
  count?: number;
  createdAt: number;
};

export type ScheduleResult = {
  at: number;
  status: number;
  duration: number;
  error?: string;
};

export type MockHit = {
  at: number;
  method: string;
  path: string;
  source: string;
};

export type BatchResult = {
  name: string;
  method: string;
  url: string;
  index: number;
  status: number;
  duration: number;
  error?: string;
  assertionsFailed: number;
};

export type BatchSummary = {
  total: number;
  ok: number;
  failed: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  durationMs: number;
};

export type CaptureEntry = {
  id: string;
  at: number;
  method: string;
  url: string;
  requestHeaders: Record<string, string[]>;
  requestBody: string;
  status: number;
  responseHeaders: Record<string, string[]>;
  responseBody: string;
  contentType: string;
  duration: number;
  tunnel?: boolean;
  error?: string;
};

export type FuzzFinding = {
  kind: string;
  target: string;
  payload: string;
  category: string;
  status: number;
  size: number;
  duration: number;
  error?: string;
  severity?: "high" | "medium" | "low" | "";
  issues?: string[] | null;
  evidence?: string[] | null;
  count?: number;
};

export type FuzzResult = {
  baseline: { status: number; size: number; duration: number; error?: string };
  results: FuzzFinding[];
  summary: {
    total: number;
    issues: number;
    high?: number;
    medium?: number;
    low?: number;
    deduped?: number;
  };
};

export type GraphQLField = {
  name: string;
  type: string;
  args?: { name: string; type: string }[];
};

export type GraphQLType = {
  name: string;
  kind: string;
  fields?: GraphQLField[];
  inputFields?: GraphQLField[];
  enumValues?: string[];
};

export type GraphQLSchema = {
  queryType: string;
  mutationType?: string;
  subscriptionType?: string;
  types: GraphQLType[];
};

export type GrpcMethod = { name: string; input: string; output: string; streaming: boolean };
export type GrpcService = { name: string; package?: string; methods: GrpcMethod[] };
export type GrpcDescriptorResult = { id: string; source: string; services: GrpcService[] };
export type GrpcStoredDescriptor = {
  id: string;
  name: string;
  size: number;
  source: string;
  target?: string;
  uploadedAt: number;
  services: GrpcService[];
};
export type GrpcResult = {
  response: string;
  code: string;
  message?: string;
  headers?: Record<string, string[]>;
  trailers?: Record<string, string[]>;
  duration: number;
};

export type PendingIntercept = {
  id: string;
  phase: "request" | "response";
  method: string;
  url: string;
  status?: number;
  headers: Record<string, string[]>;
  body: string;
  createdAt: number;
};

export type Hook = {
  enabled: boolean;
  command: string;
  timeout?: number;
  env?: KeyValue[];
};

export type Scripts = {
  pre: Hook;
  post: Hook;
};

export type ExtractRule = {
  name: string;
  path: string;
  enabled: boolean;
};

export type AssertionSource = "status" | "time" | "header" | "body" | "jsonpath";

export type Assertion = {
  id: string;
  enabled: boolean;
  source: AssertionSource;
  key: string;
  operator: string;
  value: string;
};

export type AssertionResult = {
  id: string;
  passed: boolean;
  message: string;
};

export type HookTest = {
  name: string;
  passed: boolean;
};

export type HookResult = {
  phase: "pre" | "post";
  command: string;
  ran: boolean;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  log?: string;
  tests?: HookTest[];
  variables?: Record<string, string>;
  duration: number;
};

export type GrpcCall = {
  target: string;
  service: string;
  method: string;
  descriptorId: string;
  plaintext: boolean;
  body: string;
  metadata?: KeyValue[];
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
  scripts: Scripts;
  dependsOn: string[];
  extract: ExtractRule[];
  assertions: Assertion[];
  mocks: MockResponse[];
  // protocol: "http" (default) or "grpc".
  protocol?: "http" | "grpc";
  grpc?: GrpcCall;
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
  variables?: KeyValue[];
  setupNodeId?: string;
  extract?: ExtractRule[];
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
  hooks?: HookResult[];
  assertions?: AssertionResult[];
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
  options: { timeout: 30000, followRedirects: true, verifyTLS: true, maxRedirects: 10, sendVia: "server" },
  scripts: {
    pre: { enabled: false, command: "", timeout: 10000 },
    post: { enabled: false, command: "", timeout: 10000 },
  },
  dependsOn: [],
  extract: [],
  assertions: [],
  mocks: [],
  protocol: "http",
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

export type User = {
  id: string;
  username: string;
  name: string;
  role: "admin" | "member" | "viewer" | string;
  createdAt?: string;
};

export type Project = {
  id: string;
  name: string;
  ownerId: string;
  members: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
  version?: number;
};

export type AuthStatus = {
  authEnabled: boolean;
  authenticated: boolean;
  userCount: number;
  user: User | null;
  project: string;
  role: string;
  projects: Project[];
};
