import { useState, type ReactNode } from "react";
import { Check, GitBranch, ListChecks, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CodeEditor } from "@/components/CodeEditor";
import { cn } from "@/lib/utils";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useStore } from "@/store";
import type { Assertion, AssertionSource, CollectionNode, Hook, RequestDef } from "@/lib/types";

type Section = "pre" | "post" | "assertions" | "deps";

const SECTIONS: { key: Section; label: MessageKey; icon: typeof Play }[] = [
  { key: "pre", label: "preRequest", icon: Play },
  { key: "post", label: "postResponse", icon: Check },
  { key: "assertions", label: "assertions", icon: ListChecks },
  { key: "deps", label: "dependencies", icon: GitBranch },
];

const SOURCES: { value: AssertionSource; label: MessageKey }[] = [
  { value: "status", label: "srcStatus" },
  { value: "time", label: "srcTime" },
  { value: "header", label: "srcHeader" },
  { value: "jsonpath", label: "srcJsonPath" },
  { value: "body", label: "srcBody" },
];

const OPERATORS: { value: string; label: MessageKey }[] = [
  { value: "eq", label: "opEq" },
  { value: "ne", label: "opNe" },
  { value: "contains", label: "opContains" },
  { value: "matches", label: "opMatches" },
  { value: "gt", label: "opGt" },
  { value: "gte", label: "opGte" },
  { value: "lt", label: "opLt" },
  { value: "lte", label: "opLte" },
  { value: "exists", label: "opExists" },
];

export function AutomationEditor({
  req,
  onChange,
}: {
  req: RequestDef;
  onChange: (patch: Partial<RequestDef>) => void;
}) {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>("pre");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              section === s.key
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <s.icon className="h-3.5 w-3.5" />
            {t(s.label)}
            {s.key === "assertions" && req.assertions.filter((a) => a.enabled).length > 0 && (
              <span className="rounded bg-primary/20 px-1 text-[10px]">
                {req.assertions.filter((a) => a.enabled).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {section === "pre" && (
          <HookEditor
            hook={req.scripts.pre}
            phase="pre"
            onChange={(pre) => onChange({ scripts: { ...req.scripts, pre } })}
          />
        )}
        {section === "post" && (
          <HookEditor
            hook={req.scripts.post}
            phase="post"
            onChange={(post) => onChange({ scripts: { ...req.scripts, post } })}
          />
        )}
        {section === "assertions" && (
          <AssertionsEditor
            rules={req.assertions}
            onChange={(assertions) => onChange({ assertions })}
          />
        )}
        {section === "deps" && <DependenciesEditor req={req} onChange={onChange} />}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function HookEditor({
  hook,
  phase,
  onChange,
}: {
  hook: Hook;
  phase: "pre" | "post";
  onChange: (hook: Hook) => void;
}) {
  const { t } = useI18n();
  const example =
    phase === "pre"
      ? `# stdin : {"phase":"pre","request":{...},"variables":{"baseUrl":"..."}}\n# stdout: {"variables":{"token":"abc"},"request":{"method":"GET"}}`
      : `# stdin : {"phase":"post","request":{...},"response":{"status":200,"body":"..."},"variables":{}}\n# stdout: {"tests":[{"name":"status 200","passed":true}],"variables":{"id":1}}`;

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <div className="text-sm font-medium">{t("hookEnabled")}</div>
          <div className="text-xs text-muted-foreground">{t("hookHint")}</div>
        </div>
        <Switch checked={hook.enabled} onCheckedChange={(v) => onChange({ ...hook, enabled: v })} />
      </div>

      <div className="grid grid-cols-[1fr_140px] gap-3">
        <Field label={t("hookCommand")}>
          <Input
            value={hook.command}
            placeholder={t("hookPlaceholder")}
            onChange={(e) => onChange({ ...hook, command: e.target.value })}
            className="font-mono text-xs"
            spellCheck={false}
          />
        </Field>
        <Field label={t("hookTimeout")}>
          <Input
            type="number"
            value={hook.timeout ?? 10000}
            onChange={(e) => onChange({ ...hook, timeout: Number(e.target.value) || 0 })}
          />
        </Field>
      </div>

      <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {example}
      </pre>
    </div>
  );
}

function AssertionsEditor({
  rules,
  onChange,
}: {
  rules: Assertion[];
  onChange: (rules: Assertion[]) => void;
}) {
  const { t } = useI18n();

  const update = (id: string, patch: Partial<Assertion>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => onChange(rules.filter((r) => r.id !== id));
  const add = () =>
    onChange([
      ...rules,
      {
        id: Math.random().toString(36).slice(2),
        enabled: true,
        source: "status",
        key: "",
        operator: "eq",
        value: "200",
      },
    ]);

  return (
    <div className="p-3">
      <p className="mb-3 text-xs text-muted-foreground">{t("assertionsHint")}</p>
      {rules.length === 0 && (
        <div className="mb-3 rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          {t("assertionsEmpty")}
        </div>
      )}
      <div className="space-y-2">
        {rules.map((rule) => {
          const needsKey = rule.source === "header" || rule.source === "jsonpath";
          const needsValue = rule.operator !== "exists";
          return (
            <div
              key={rule.id}
              className={cn(
                "flex items-center gap-2 rounded-lg border p-2",
                !rule.enabled && "opacity-50",
              )}
            >
              <button
                onClick={() => update(rule.id, { enabled: !rule.enabled })}
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                  rule.enabled ? "border-primary bg-primary text-primary-foreground" : "border-input",
                )}
              >
                {rule.enabled && <Check className="h-3 w-3" />}
              </button>

              <Select
                value={rule.source}
                onValueChange={(v) => update(rule.id, { source: v as AssertionSource })}
              >
                <SelectTrigger className="h-8 w-[120px] shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {t(s.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                value={rule.key}
                disabled={!needsKey}
                placeholder={keyPlaceholder(rule.source, t)}
                onChange={(e) => update(rule.id, { key: e.target.value })}
                className="h-8 flex-1 font-mono text-xs"
              />

              <Select value={rule.operator} onValueChange={(v) => update(rule.id, { operator: v })}>
                <SelectTrigger className="h-8 w-[130px] shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(o.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                value={rule.value}
                disabled={!needsValue}
                placeholder={t("assertValuePlaceholder")}
                onChange={(e) => update(rule.id, { value: e.target.value })}
                className="h-8 flex-1 font-mono text-xs"
              />

              <button
                onClick={() => remove(rule.id)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      <Button variant="ghost" size="sm" className="mt-3 gap-1.5 text-muted-foreground" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> {t("addAssertion")}
      </Button>
    </div>
  );
}

function keyPlaceholder(source: AssertionSource, t: (k: MessageKey) => string) {
  if (source === "header") return "Content-Type";
  if (source === "jsonpath") return "$.data.token";
  return t("assertKeyPlaceholder");
}

function DependenciesEditor({
  req,
  onChange,
}: {
  req: RequestDef;
  onChange: (patch: Partial<RequestDef>) => void;
}) {
  const { t } = useI18n();
  const collections = useStore((s) => s.collections);
  const all = flattenRequests(collections);
  const selected = req.dependsOn ?? [];
  const available = all.filter((r) => r.id !== req.id && !selected.includes(r.id));

  const addParent = (id: string) => onChange({ dependsOn: [...selected, id] });
  const removeParent = (id: string) => onChange({ dependsOn: selected.filter((x) => x !== id) });

  const addExtract = () =>
    onChange({
      extract: [...(req.extract ?? []), { name: "", path: "", enabled: true }],
    });
  const updateExtract = (idx: number, patch: Partial<{ name: string; path: string; enabled: boolean }>) =>
    onChange({ extract: req.extract.map((e, i) => (i === idx ? { ...e, ...patch } : e)) });
  const removeExtract = (idx: number) => onChange({ extract: req.extract.filter((_, i) => i !== idx) });

  return (
    <div className="space-y-5 p-3">
      <p className="text-xs text-muted-foreground">{t("chainHint")}</p>

      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">{t("dependencies")}</div>
        {selected.length === 0 && (
          <div className="mb-2 rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
            {t("depsEmpty")}
          </div>
        )}
        <div className="space-y-1.5">
          {selected.map((id) => {
            const node = all.find((r) => r.id === id);
            return (
              <div key={id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                <span className={cn("text-[10px] font-semibold", `method-${node?.method ?? "GET"}`)}>
                  {node?.method}
                </span>
                <span className="min-w-0 flex-1 truncate">{node?.name ?? id}</span>
                <button
                  onClick={() => removeParent(id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
        <Select value="" onValueChange={addParent}>
          <SelectTrigger className="mt-2 h-8 text-xs">
            <SelectValue placeholder={t("addParent")} />
          </SelectTrigger>
          <SelectContent>
            {available.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("selectRequest")}</div>
            )}
            {available.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                <span className={cn("mr-1.5 text-[10px] font-semibold", `method-${r.method}`)}>
                  {r.method}
                </span>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">{t("extractTitle")}</div>
        <div className="space-y-2">
          {(req.extract ?? []).map((rule, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                value={rule.name}
                placeholder={t("extractName")}
                onChange={(e) => updateExtract(idx, { name: e.target.value })}
                className="h-8 flex-1 font-mono text-xs"
              />
              <Input
                value={rule.path}
                placeholder={t("extractPath")}
                onChange={(e) => updateExtract(idx, { path: e.target.value })}
                className="h-8 flex-1 font-mono text-xs"
              />
              <button
                onClick={() => removeExtract(idx)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="mt-2 gap-1.5 text-muted-foreground" onClick={addExtract}>
          <Plus className="h-3.5 w-3.5" /> {t("addExtract")}
        </Button>
      </div>
    </div>
  );
}

function flattenRequests(
  nodes: CollectionNode[],
): { id: string; name: string; method: string; url: string }[] {
  const out: { id: string; name: string; method: string; url: string }[] = [];
  for (const n of nodes) {
    if (n.type === "request" && n.request) {
      out.push({ id: n.id, name: n.name, method: n.request.method, url: n.request.url });
    }
    if (n.children) out.push(...flattenRequests(n.children));
  }
  return out;
}
