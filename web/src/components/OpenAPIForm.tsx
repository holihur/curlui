import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import type { RequestDef } from "@/lib/types";

// OpenAPIForm renders the parameters of an imported operation as a form and
// writes the values back into the request (query params, headers, path
// variables and the JSON body), so a request can be filled in without editing
// raw JSON.
export function OpenAPIForm({
  req,
  onChange,
}: {
  req: RequestDef;
  onChange: (patch: Partial<RequestDef>) => void;
}) {
  const { t } = useI18n();
  const fields = req.openapi?.fields ?? [];
  if (fields.length === 0) return null;

  const read = (name: string, where: "params" | "headers"): string => {
    const kv = (req[where] ?? []).find((x) => x.key.toLowerCase() === name.toLowerCase());
    return kv?.value ?? "";
  };

  const readBody = (name: string): string => {
    try {
      const obj = JSON.parse(req.body.raw || "{}");
      const v = obj?.[name];
      return v === undefined || v === null ? "" : String(v);
    } catch {
      return "";
    }
  };

  const writeKV = (where: "params" | "headers", name: string, value: string) => {
    const list = [...(req[where] ?? [])];
    const i = list.findIndex((x) => x.key.toLowerCase() === name.toLowerCase());
    if (i >= 0) list[i] = { ...list[i], value, enabled: value !== "" };
    else list.push({ id: `${where}-${name}`, key: name, value, enabled: value !== "" });
    onChange({ [where]: list } as Partial<RequestDef>);
  };

  const writeBody = (name: string, value: string, type: string) => {
    let obj: Record<string, unknown> = {};
    try {
      obj = JSON.parse(req.body.raw || "{}") ?? {};
    } catch {
      obj = {};
    }
    if (value === "") delete obj[name];
    else if (type === "integer" || type === "number") obj[name] = Number(value);
    else if (type === "boolean") obj[name] = value === "true";
    else obj[name] = value;
    onChange({ body: { ...req.body, type: "json", raw: JSON.stringify(obj, null, 2) } });
  };

  const writePath = (name: string, value: string) => {
    const url = req.url.replace(new RegExp(`\\{\\{?${name}\\}?\\}`, "g"), value || `{{${name}}}`);
    onChange({ url });
  };

  const valueOf = (name: string, where: string, type?: string) => {
    if (where === "body") return readBody(name);
    if (where === "path") return "";
    return read(name, where === "header" ? "headers" : "params");
  };

  const setValue = (name: string, where: string, type: string, value: string) => {
    if (where === "body") writeBody(name, value, type);
    else if (where === "path") writePath(name, value);
    else writeKV(where === "header" ? "headers" : "params", name, value);
  };

  return (
    <div className="space-y-3 p-3">
      <p className="text-[11px] text-muted-foreground">{t("openapiFormHint")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const id = `oapi-${f.in}-${f.name}`;
          const value = valueOf(f.name, f.in, f.type);
          return (
            <div key={id} className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={id} className="flex items-center gap-1 text-xs">
                <span className="truncate font-mono">{f.name}</span>
                {f.required && <span className="text-destructive">*</span>}
                <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{f.in}</span>
                {f.type && <span className="text-[10px] text-muted-foreground">{f.type}</span>}
              </Label>
              {f.enum && f.enum.length > 0 ? (
                <Select value={value || ""} onValueChange={(v) => setValue(f.name, f.in, f.type ?? "", v)}>
                  <SelectTrigger id={id} className="h-8 text-xs">
                    <SelectValue placeholder={f.example || "—"} />
                  </SelectTrigger>
                  <SelectContent>
                    {f.enum.map((e) => (
                      <SelectItem key={e} value={e} className="text-xs">
                        {e}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.type === "boolean" ? (
                <Select
                  value={value || ""}
                  onValueChange={(v) => setValue(f.name, f.in, "boolean", v)}
                >
                  <SelectTrigger id={id} className="h-8 text-xs">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true" className="text-xs">
                      true
                    </SelectItem>
                    <SelectItem value="false" className="text-xs">
                      false
                    </SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={id}
                  className="h-8 font-mono text-xs"
                  value={value}
                  placeholder={f.example || (f.required ? t("requiredField") : "")}
                  onChange={(e) => setValue(f.name, f.in, f.type ?? "", e.target.value)}
                />
              )}
              {f.description && (
                <span className="truncate text-[10px] text-muted-foreground" title={f.description}>
                  {f.description}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
