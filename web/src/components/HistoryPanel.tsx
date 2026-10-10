import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatMs, relativeTime, statusColor } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/store";

export function HistoryPanel() {
  const { t } = useI18n();
  const history = useStore((s) => s.history);
  const openHistory = useStore((s) => s.openHistory);
  const clearHistory = useStore((s) => s.clearHistory);
  const deleteHistory = useStore((s) => s.deleteHistory);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t("historyCount", { n: history.length })}
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="gap-1 text-muted-foreground"
          disabled={history.length === 0}
          onClick={() => clearHistory()}
        >
          <Trash2 className="h-3.5 w-3.5" /> {t("clear")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {history.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            {t("historyEmpty")}
          </div>
        )}
        {history.map((h) => (
          <div
            key={h.id}
            className="group flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-sidebar-accent/70"
            onClick={() => openHistory(h)}
          >
            <div className="flex items-center gap-2">
              <span className={cn("shrink-0 text-[10px] font-semibold", `method-${h.request.method}`)}>
                {h.request.method}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs" title={h.request.url}>
                {h.request.url || "(no url)"}
              </span>
              <button
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteHistory(h.id);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="flex items-center gap-2 pl-9 text-[10px] text-muted-foreground">
              <span className={statusColor(h.status)}>{h.error ? "error" : h.status || "—"}</span>
              <span>{formatMs(h.duration)}</span>
              <span className="ml-auto">{relativeTime(h.createdAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
