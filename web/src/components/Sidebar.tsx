import { useState } from "react";
import { Clock, FolderTree, Settings2, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, type MessageKey } from "@/lib/i18n";import { CollectionsPanel } from "@/components/CollectionsPanel";
import { HistoryPanel } from "@/components/HistoryPanel";
import { EnvPanel } from "@/components/EnvPanel";
import { SchedulePanel } from "@/components/SchedulePanel";

type TabKey = "collections" | "history" | "env" | "schedules";

const TABS: { key: TabKey; label: MessageKey; icon: typeof FolderTree }[] = [
  { key: "collections", label: "collections", icon: FolderTree },
  { key: "history", label: "history", icon: Clock },
  { key: "env", label: "environments", icon: Settings2 },
  { key: "schedules", label: "schedules", icon: Timer },
];

export function Sidebar() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabKey>("collections");
  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="grid shrink-0 grid-cols-4 items-center gap-1 border-b p-1.5">
        {TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            title={t(item.label)}
            className={cn(
              "flex min-w-0 items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[11px] font-medium transition-colors",
              tab === item.key
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t(item.label)}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "collections" && <CollectionsPanel />}
        {tab === "history" && <HistoryPanel />}
        {tab === "env" && <EnvPanel />}
        {tab === "schedules" && <SchedulePanel />}
      </div>
    </aside>
  );
}
