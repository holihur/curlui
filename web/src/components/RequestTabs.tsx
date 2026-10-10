import { useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PromptDialog } from "@/components/PromptDialog";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/store";

export function RequestTabs() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const newTab = useStore((s) => s.newTab);
  const renameTab = useStore((s) => s.renameTab);
  const { t } = useI18n();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  if (tabs.length === 0) return null;

  return (
    <div className="flex h-10 shrink-0 items-stretch border-b bg-card">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((t) => {
          const active = t.id === activeTabId;
          return (
            <div
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              onDoubleClick={() => setRenaming({ id: t.id, name: t.name })}
              className={cn(
                "group flex min-w-[150px] max-w-[240px] cursor-pointer items-center gap-2 border-r px-3 text-sm transition-colors",
                active
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  `method-${t.request.method}`,
                  "bg-current",
                )}
              />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {t.sending && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-accent group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        onClick={() => newTab()}
        title={t("newRequest")}
        className="flex w-10 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>

      <PromptDialog
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
        title={t("renameRequest")}
        defaultValue={renaming?.name ?? ""}
        submitLabel={t("rename")}
        onSubmit={(v) => {
          if (renaming && v) renameTab(renaming.id, v);
        }}
      />
    </div>
  );
}
