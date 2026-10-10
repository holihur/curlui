import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";

export type Locale = "en" | "zh";

const en = {
  // top bar
  new: "New",
  create: "Create",
  rename: "Rename",
  delete: "Delete",
  duplicate: "Duplicate",
  copyAsCurl: "Copy as cURL",
  duplicated: "Duplicated",
  copiedToClipboard: "Copied to clipboard",
  importCurl: "Import cURL",
  importOpenapi: "Import OpenAPI",
  environment: "Environment",
  noEnvironment: "No environment",
  toggleTheme: "Toggle theme",
  language: "Language",

  // sidebar
  collections: "Collections",
  history: "History",
  environments: "Environments",

  // collections
  searchRequests: "Search requests…",
  newRequest: "New request",
  newFolder: "New folder",
  collectionsEmpty: "No saved requests yet. Save one from the editor, or create it here.",
  deleteNodeConfirm: 'Delete "{name}"? This cannot be undone.',

  // history
  historyCount: "{n} requests",
  clear: "Clear",
  historyEmpty: "Sent requests will appear here.",

  // environments
  variables: "Variables",
  newEnvironment: "New",
  envEmpty: "No environments. Create one to use {{variables}}.",
  envDeleteConfirm: 'Delete environment "{name}"?',
  envName: "Environment name",
  varsCount: "{n} vars",

  // tabs
  renameRequest: "Rename request",

  // editor / url bar
  send: "Send",
  saveTooltip: "Save (Ctrl+S)",
  codeTooltip: "Generate cURL code",
  urlPlaceholder: "https://api.example.com/endpoint  or  {{base_url}}/users",
  params: "Params",
  authorization: "Authorization",
  headers: "Headers",
  body: "Body",
  options: "Options",
  beautify: "Beautify",
  loading: "Sending…",
  kvKey: "Key",
  kvValue: "Value",
  kvDescription: "Description",
  kvType: "Type",
  kvText: "Text",
  kvFile: "File",
  addRow: "Add row",
  enable: "Enable",
  disable: "Disable",

  // auth
  authType: "Auth type",
  noAuth: "No auth",
  basicAuth: "Basic auth",
  bearerToken: "Bearer token",
  apiKey: "API key",
  username: "Username",
  password: "Password",
  token: "Token",
  key: "Key",
  value: "Value",
  addTo: "Add to",
  header: "Header",
  queryParam: "Query param",
  noAuthHint: "This request does not use any authorization.",

  // body
  bodyNone: "none",
  bodyJson: "JSON",
  bodyFormUrlencoded: "x-www-form-urlencoded",
  bodyFormData: "form-data",
  bodyXml: "XML",
  bodyText: "Text",
  bodyHtml: "HTML",
  bodyBinary: "Binary",
  bodyPlaceholder: '{ "key": "value" }',
  requestBodyPlaceholder: "Request body…",
  filePathLabel: "File path (on the server running curlui)",
  noBody: "This request has no body.",

  // options
  timeoutMs: "Timeout (ms)",
  maxRedirects: "Max redirects",
  proxy: "Proxy (http://host:port)",
  followRedirects: "Follow redirects",
  followRedirectsDesc: "Automatically follow 3xx responses",
  verifyTls: "Verify TLS certificate",
  verifyTlsDesc: "Disable to allow self-signed certificates",

  // response
  sending: "Sending request…",
  responseEmpty: "Send a request to see the response here.",
  error: "Error",
  binaryTag: "binary",
  copy: "Copy",
  copied: "Copied",
  respBody: "body",
  respHeaders: "headers",
  respCookies: "cookies",
  respTiming: "timing",
  respRequest: "request",
  pretty: "Pretty",
  raw: "Raw",
  emptyBody: "(empty body)",
  noCookies: "No cookies in the response.",
  binaryResponse: "Binary response",
  download: "Download",
  nothingHere: "Nothing here.",
  dnsLookup: "DNS lookup",
  tcpConnect: "TCP connect",
  tlsHandshake: "TLS handshake",
  waitingTtfb: "Waiting (TTFB)",
  contentDownload: "Content download",
  total: "Total",

  // dialogs: curl
  importCurlTitle: "Import cURL",
  importCurlDesc:
    "Paste a cURL command to turn it into a request. Method, headers, body and auth are detected automatically.",
  cancel: "Cancel",
  importAction: "Import",

  // dialogs: openapi
  openapiTitle: "Import OpenAPI / Swagger",
  openapiDesc:
    "Point at a Swagger 2.0 or OpenAPI 3.x document. Every operation becomes a ready-to-send request in your Collections.",
  fromUrl: "From URL",
  paste: "Paste",
  specUrlPlaceholder: "https://petstore3.swagger.io/api/v3/openapi.json",
  pastePlaceholder: "Paste JSON or YAML here…",
  chooseFile: "Choose file",
  preview: "Fetch & Preview",
  previewTitle: "Preview",
  specLoading: "Fetching spec…",
  endpointsCount: "{n} operations",
  addToCollections: "Add to Collections",
  back: "Back",
  openapiImported: "Imported {n} requests",
  urlRequired: "Enter a spec URL",
  contentRequired: "Paste a spec or choose a file",
  openapiHint: "Accepts .json, .yaml and .yml",

  // code dialog
  codeTitle: "cURL command",
  codeDesc: "The equivalent shell command.",
  codeDescVars: "Variables are shown as placeholders.",

  // automation (hooks / assertions / chaining)
  automation: "Automation",
  preRequest: "Pre-request",
  postResponse: "Post-response",
  assertions: "Assertions",
  dependencies: "Dependencies",
  hookEnabled: "Enabled",
  hookCommand: "Command",
  hookTimeout: "Timeout (ms)",
  hookPlaceholder: "e.g. node scripts/auth.js",
  hookHint: "Runs as a child process: JSON context on stdin, JSON result on stdout.",
  addAssertion: "Add assertion",
  assertionSource: "Source",
  assertionKey: "Key / path",
  assertionValue: "Expected",
  assertKeyPlaceholder: "header name or $.path",
  assertValuePlaceholder: "value",
  srcStatus: "Status",
  srcTime: "Time",
  srcHeader: "Header",
  srcBody: "Body",
  srcJsonPath: "JSON path",
  opEq: "equals",
  opNe: "not equals",
  opContains: "contains",
  opGt: "greater than",
  opGte: "greater or equal",
  opLt: "less than",
  opLte: "less or equal",
  opExists: "exists",
  opMatches: "matches regex",
  assertionsEmpty: "No assertions yet. Add one to check the response.",
  assertionsHint: "When assertions pass, the request indicator turns green.",
  depsEmpty: "No parent requests. Add parents to reference their response values.",
  addParent: "Add parent",
  selectRequest: "Select request",
  extractTitle: "Extract variables from this response",
  extractName: "Variable",
  extractPath: "JSON path",
  addExtract: "Add extraction",
  chainHint: "Parent requests run first. Extracted values are available as {{name}} here.",
  testsResults: "Tests",
  testsPassedSummary: "{n} passed",
  testsFailedSummary: "{n} failed",
  scriptsRun: "{n} scripts",
  hookNoOutput: "(no output)",
  noTests: "No assertions or hooks configured for this request.",
  statusPassed: "Assertions passed",
  statusFailed: "Assertions failed",
  statusNone: "Not run",

  // toasts
  requestFailed: "Request failed",
  urlRequiredToast: "URL is required",
  folderCreated: "Folder created",
  couldNotCreateFolder: "Could not create folder",
  couldNotSave: "Could not save request",
  requestSaved: "Request saved",
  saveFailed: "Save failed",
  renameFailed: "Rename failed",
  deleted: "Deleted",
  deleteFailed: "Delete failed",
  moveFailed: "Move failed",
  couldNotClearHistory: "Could not clear history",
  envSaved: "Environment saved",
  importedCurl: "Imported cURL command",
} as const;

export type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  new: "新建",
  create: "创建",
  rename: "重命名",
  delete: "删除",
  duplicate: "复制",
  copyAsCurl: "复制为 cURL",
  duplicated: "已复制",
  copiedToClipboard: "已复制到剪贴板",
  importCurl: "导入 cURL",
  importOpenapi: "导入 OpenAPI",
  environment: "环境",
  noEnvironment: "无环境",
  toggleTheme: "切换主题",
  language: "语言",

  collections: "集合",
  history: "历史",
  environments: "环境",

  searchRequests: "搜索请求…",
  newRequest: "新建请求",
  newFolder: "新建文件夹",
  collectionsEmpty: "还没有保存的请求。可在编辑器中保存，或在此新建。",
  deleteNodeConfirm: "确定删除“{name}”？此操作不可撤销。",

  historyCount: "{n} 条请求",
  clear: "清空",
  historyEmpty: "发送过的请求会显示在这里。",

  variables: "变量",
  newEnvironment: "新建",
  envEmpty: "暂无环境。新建一个即可使用 {{variables}}。",
  envDeleteConfirm: "确定删除环境“{name}”？",
  envName: "环境名称",
  varsCount: "{n} 个变量",

  renameRequest: "重命名请求",

  send: "发送",
  saveTooltip: "保存 (Ctrl+S)",
  codeTooltip: "生成 cURL 代码",
  urlPlaceholder: "https://api.example.com/endpoint  或  {{base_url}}/users",
  params: "参数",
  authorization: "认证",
  headers: "请求头",
  body: "请求体",
  options: "选项",
  beautify: "格式化",
  loading: "发送中…",
  kvKey: "键",
  kvValue: "值",
  kvDescription: "描述",
  kvType: "类型",
  kvText: "文本",
  kvFile: "文件",
  addRow: "添加一行",
  enable: "启用",
  disable: "禁用",

  authType: "认证类型",
  noAuth: "无认证",
  basicAuth: "Basic 认证",
  bearerToken: "Bearer 令牌",
  apiKey: "API Key",
  username: "用户名",
  password: "密码",
  token: "令牌",
  key: "键",
  value: "值",
  addTo: "添加到",
  header: "请求头",
  queryParam: "查询参数",
  noAuthHint: "此请求未使用任何认证。",

  bodyNone: "无",
  bodyJson: "JSON",
  bodyFormUrlencoded: "x-www-form-urlencoded",
  bodyFormData: "form-data",
  bodyXml: "XML",
  bodyText: "文本",
  bodyHtml: "HTML",
  bodyBinary: "二进制",
  bodyPlaceholder: '{ "key": "value" }',
  requestBodyPlaceholder: "请求体…",
  filePathLabel: "文件路径（位于运行 curlui 的服务器上）",
  noBody: "此请求没有请求体。",

  timeoutMs: "超时（毫秒）",
  maxRedirects: "最大重定向次数",
  proxy: "代理 (http://host:port)",
  followRedirects: "跟随重定向",
  followRedirectsDesc: "自动跟随 3xx 响应",
  verifyTls: "校验 TLS 证书",
  verifyTlsDesc: "关闭以允许自签名证书",

  sending: "正在发送请求…",
  responseEmpty: "发送请求后，响应会显示在这里。",
  error: "错误",
  binaryTag: "二进制",
  copy: "复制",
  copied: "已复制",
  respBody: "响应体",
  respHeaders: "响应头",
  respCookies: "Cookies",
  respTiming: "耗时",
  respRequest: "请求",
  pretty: "美化",
  raw: "原始",
  emptyBody: "（空响应体）",
  noCookies: "响应中没有 Cookie。",
  binaryResponse: "二进制响应",
  download: "下载",
  nothingHere: "暂无内容。",
  dnsLookup: "DNS 解析",
  tcpConnect: "TCP 连接",
  tlsHandshake: "TLS 握手",
  waitingTtfb: "等待响应 (TTFB)",
  contentDownload: "内容下载",
  total: "总计",

  importCurlTitle: "导入 cURL",
  importCurlDesc: "粘贴 cURL 命令即可生成请求，自动识别方法、请求头、请求体与认证。",
  cancel: "取消",
  importAction: "导入",

  openapiTitle: "导入 OpenAPI / Swagger",
  openapiDesc:
    "输入 Swagger 2.0 或 OpenAPI 3.x 文档地址，每个接口都会变成集合中可直接发送的请求。",
  fromUrl: "从地址",
  paste: "粘贴",
  specUrlPlaceholder: "https://petstore3.swagger.io/api/v3/openapi.json",
  pastePlaceholder: "在此粘贴 JSON 或 YAML…",
  chooseFile: "选择文件",
  preview: "获取并预览",
  previewTitle: "预览",
  specLoading: "正在获取文档…",
  endpointsCount: "{n} 个接口",
  addToCollections: "添加到集合",
  back: "返回",
  openapiImported: "已导入 {n} 个请求",
  urlRequired: "请输入文档地址",
  contentRequired: "请粘贴内容或选择文件",
  openapiHint: "支持 .json、.yaml、.yml",

  codeTitle: "cURL 命令",
  codeDesc: "等价的 shell 命令。",
  codeDescVars: "变量以占位符形式显示。",

  automation: "自动化",
  preRequest: "请求前",
  postResponse: "请求后",
  assertions: "断言",
  dependencies: "依赖",
  hookEnabled: "启用",
  hookCommand: "命令",
  hookTimeout: "超时（毫秒）",
  hookPlaceholder: "例如 node scripts/auth.js",
  hookHint: "作为子进程运行：上下文 JSON 写入 stdin，结果 JSON 从 stdout 读取。",
  addAssertion: "添加断言",
  assertionSource: "来源",
  assertionKey: "键 / 路径",
  assertionValue: "期望值",
  assertKeyPlaceholder: "请求头名称或 $.路径",
  assertValuePlaceholder: "值",
  srcStatus: "状态码",
  srcTime: "耗时",
  srcHeader: "响应头",
  srcBody: "响应体",
  srcJsonPath: "JSON 路径",
  opEq: "等于",
  opNe: "不等于",
  opContains: "包含",
  opGt: "大于",
  opGte: "大于等于",
  opLt: "小于",
  opLte: "小于等于",
  opExists: "存在",
  opMatches: "匹配正则",
  assertionsEmpty: "暂无断言。添加一个来校验响应。",
  assertionsHint: "断言通过时，请求左侧的指示器会变绿。",
  depsEmpty: "暂无父级请求。添加父级即可引用其返回值。",
  addParent: "添加父级",
  selectRequest: "选择请求",
  extractTitle: "从该响应中提取变量",
  extractName: "变量",
  extractPath: "JSON 路径",
  addExtract: "添加提取",
  chainHint: "父级请求会先执行，提取出的值可在本请求中以 {{name}} 引用。",
  testsResults: "测试",
  testsPassedSummary: "{n} 个通过",
  testsFailedSummary: "{n} 个失败",
  scriptsRun: "{n} 个脚本",
  hookNoOutput: "（无输出）",
  noTests: "该请求未配置断言或脚本。",
  statusPassed: "断言通过",
  statusFailed: "断言失败",
  statusNone: "未运行",

  requestFailed: "请求失败",
  urlRequiredToast: "URL 不能为空",
  folderCreated: "文件夹已创建",
  couldNotCreateFolder: "创建文件夹失败",
  couldNotSave: "保存请求失败",
  requestSaved: "请求已保存",
  saveFailed: "保存失败",
  renameFailed: "重命名失败",
  deleted: "已删除",
  deleteFailed: "删除失败",
  moveFailed: "移动失败",
  couldNotClearHistory: "清空历史失败",
  envSaved: "环境已保存",
  importedCurl: "已导入 cURL 命令",
};

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, zh };

function format(str: string, vars?: Vars): string {
  if (!vars) return str;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}

// Module-level locale so non-React code (e.g. the Zustand store) can translate.
let currentLocale: Locale = "en";

export function translate(key: MessageKey, vars?: Vars): string {
  return format(dictionaries[currentLocale][key] ?? key, vars);
}

export function setGlobalLocale(locale: Locale) {
  currentLocale = locale;
}

export const LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh", label: "简体中文" },
];

type Vars = Record<string, string | number>;

export type Theme = "light" | "dark";

type I18nContextValue = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "curlui.locale";
const THEME_KEY = "curlui.theme";

function readLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "en" || saved === "zh") return saved;
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function readTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "dark";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readLocale);
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const syncedRef = useRef(false);

  // Apply language.
  useEffect(() => {
    document.documentElement.lang = locale;
    setGlobalLocale(locale);
  }, [locale]);

  // Apply theme.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Pull persisted preferences from the backend once (survives cleared cache
  // and follows the user across browsers/devices).
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    api
      .getSettings()
      .then((s) => {
        const l = s.language;
        if (l === "en" || l === "zh") {
          setGlobalLocale(l);
          setLocaleState(l);
          localStorage.setItem(STORAGE_KEY, l);
        }
        const th = s.theme;
        if (th === "light" || th === "dark") {
          setThemeState(th);
          localStorage.setItem(THEME_KEY, th);
        }
      })
      .catch(() => {});
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setGlobalLocale(l);
    setLocaleState(l);
    localStorage.setItem(STORAGE_KEY, l);
    void api.saveSettings({ language: l }).catch(() => {});
  }, []);

  const setTheme = useCallback((th: Theme) => {
    setThemeState(th);
    localStorage.setItem(THEME_KEY, th);
    void api.saveSettings({ theme: th }).catch(() => {});
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  const t = useCallback(
    (key: MessageKey, vars?: Vars) => format(dictionaries[locale][key] ?? key, vars),
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, theme, setTheme, toggleTheme }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
