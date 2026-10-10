import { Check, GripVertical, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { emptyKV, type KeyValue } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

type Props = {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  showDescription?: boolean;
  showFiles?: boolean;
};

export function KeyValueEditor({ items: rawItems, onChange, showDescription, showFiles }: Props) {
  const { t } = useI18n();
  const items = rawItems ?? [];
  const update = (index: number, patch: Partial<KeyValue>) => {
    const next = [...items];
    if (index >= next.length) return;
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  // Turn the trailing blank row into a real item.
  const ensureRow = (index: number): number => {
    if (index < items.length) return index;
    const next = [...items, emptyKV()];
    onChange(next);
    return next.length - 1;
  };

  const remove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const rows = [...items, emptyKV()];

  return (
    <div className="flex flex-col text-sm">
      <div className="flex items-center gap-2 border-b px-2 py-1.5 text-xs font-medium text-muted-foreground">
        <span className="w-4" />
        <span className="flex-1">{t("kvKey")}</span>
        <span className="flex-1">{t("kvValue")}</span>
        {showFiles && <span className="w-20">{t("kvType")}</span>}
        {showDescription && <span className="flex-1">{t("kvDescription")}</span>}
        <span className="w-6" />
      </div>
      <div className="max-h-[260px] overflow-y-auto">
        {rows.map((row, i) => {
          const isBlank = i >= items.length;
          const disabled = !isBlank && !row.enabled;
          return (
            <div
              key={isBlank ? "__new__" : row.id}
              className={cn(
                "group flex items-center gap-2 border-b border-border/50 px-2",
                !isBlank && !row.enabled && "opacity-50",
              )}
            >
              <button
                type="button"
                onClick={() => !isBlank && update(i, { enabled: !row.enabled })}
                className={cn(
                  "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                  !isBlank && row.enabled ? "border-primary bg-primary text-primary-foreground" : "border-input",
                )}
                title={row.enabled ? t("disable") : t("enable")}
              >
                {!isBlank && row.enabled && <Check className="h-2.5 w-2.5" />}
              </button>

              <Input
                value={row.key}
                placeholder={isBlank ? t("kvKey") : ""}
                onChange={(e) => update(ensureRow(i), { key: e.target.value })}
                className="h-8 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
              <Input
                value={row.value}
                placeholder={isBlank ? t("kvValue") : ""}
                disabled={disabled && showFiles && row.type === "file"}
                onChange={(e) => update(ensureRow(i), { value: e.target.value })}
                className="h-8 flex-1 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
              />

              {showFiles && (
                <Select
                  value={row.type ?? "text"}
                  onValueChange={(v) => update(ensureRow(i), { type: v as "text" | "file" })}
                >
                  <SelectTrigger className="h-7 w-20 border-0 bg-transparent text-xs shadow-none focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">{t("kvText")}</SelectItem>
                    <SelectItem value="file">{t("kvFile")}</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {showDescription && (
                <Input
                  value={row.description ?? ""}
                  placeholder={isBlank ? t("kvDescription") : ""}
                  onChange={(e) => update(ensureRow(i), { description: e.target.value })}
                  className="h-8 flex-1 border-0 bg-transparent px-1 text-xs text-muted-foreground shadow-none focus-visible:ring-0 dark:bg-transparent"
                />
              )}

              <button
                type="button"
                onClick={() => !isBlank && remove(i)}
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-100 transition-opacity hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100",
                  isBlank && "pointer-events-none",
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={() => onChange([...items, emptyKV()])}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> {t("addRow")}
        </button>
        <GripVertical className="ml-auto h-3.5 w-3.5 text-muted-foreground/40" />
      </div>
    </div>
  );
}
