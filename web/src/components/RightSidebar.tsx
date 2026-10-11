import { lazy, Suspense, useState } from "react";
import { History, Timer, X } from "lucide-react";
import { HistoryPanel } from "@/components/HistoryPanel";
import { cn } from "@/lib/utils";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useStore } from "@/store";

const SchedulePanel = lazy(() =>
  import("@/components/SchedulePanel").then((m) => ({ default: m.SchedulePanel })),
);

type TabKey = "history" | "jobs";

const TABS: { key: TabKey; label: MessageKey; icon: typeof History }[] = [
  { key: "history", label: "history", icon: History },
  { key: "jobs", label: "jobsShort", icon: Timer },
];

// RightSidebar hosts history and scheduled jobs on the right, resizable and closable.
export function RightSidebar() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabKey>("history");
  const open = useStore((s) => s.rightOpen);
  const setOpen = useStore((s) => s.setRightOpen);
  const width = useStore((s) => s.rightWidth);
  const setWidth = useStore((s) => s.setRightWidth);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => setWidth(window.innerWidth - ev.clientX);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <aside
      style={{ ["--rw" as string]: `${width}px` }}
      className={cn(
        "absolute inset-y-0 right-0 z-30 flex w-[86vw] max-w-[360px] shrink-0 flex-col border-l bg-sidebar text-sidebar-foreground transition-transform duration-200",
        "md:static md:max-w-none md:w-[var(--rw)]",
        open ? "translate-x-0" : "translate-x-full md:hidden",
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-1.5">
        {TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            title={t(item.label)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
              tab === item.key
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
            {t(item.label)}
          </button>
        ))}
        <button
          onClick={() => setOpen(false)}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t("close")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "history" && <HistoryPanel />}
        {tab === "jobs" && (
          <Suspense fallback={null}>
            <SchedulePanel />
          </Suspense>
        )}
      </div>

      {/* Drag to resize (desktop only) */}
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        className="absolute inset-y-0 -left-1 z-40 hidden w-2 cursor-col-resize hover:bg-primary/20 md:block"
      />
    </aside>
  );
}
