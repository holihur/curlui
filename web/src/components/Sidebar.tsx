import { lazy, Suspense, useState } from "react";
import { Activity, Clock, FolderTree, Settings2, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useStore } from "@/store";
import { CollectionsPanel } from "@/components/CollectionsPanel";
import { HistoryPanel } from "@/components/HistoryPanel";
import { EnvPanel } from "@/components/EnvPanel";

// Loaded on demand: these tabs are not part of the first paint.
const SchedulePanel = lazy(() =>
  import("@/components/SchedulePanel").then((m) => ({ default: m.SchedulePanel })),
);
const TrafficPanel = lazy(() =>
  import("@/components/TrafficPanel").then((m) => ({ default: m.TrafficPanel })),
);

type TabKey = "collections" | "history" | "env" | "schedules" | "traffic";

const TABS: { key: TabKey; label: MessageKey; icon: typeof FolderTree }[] = [
  { key: "collections", label: "apis", icon: FolderTree },
  { key: "history", label: "history", icon: Clock },
  { key: "env", label: "envShort", icon: Settings2 },
  { key: "schedules", label: "jobsShort", icon: Timer },
  { key: "traffic", label: "traffic", icon: Activity },
];

export function Sidebar() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabKey>("collections");
  const open = useStore((s) => s.sidebarOpen);
  return (
    <aside
      className={cn(
        "absolute inset-y-0 left-0 z-30 flex w-[86vw] max-w-[320px] shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-transform duration-200",
        "md:static md:w-[320px] md:max-w-none md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
      )}
    >
      <div className="grid shrink-0 grid-cols-5 items-center gap-1 border-b p-1.5">
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
        {tab === "schedules" && (
          <Suspense fallback={null}>
            <SchedulePanel />
          </Suspense>
        )}
        {tab === "traffic" && (
          <Suspense fallback={null}>
            <TrafficPanel />
          </Suspense>
        )}
      </div>
    </aside>
  );
}
