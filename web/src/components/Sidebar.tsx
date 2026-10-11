import { lazy, Suspense } from "react";
import { FolderTree, Network, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useStore } from "@/store";
import { CollectionsPanel } from "@/components/CollectionsPanel";
import { EnvPanel } from "@/components/EnvPanel";

// Loaded on demand: this tab is not part of the first paint.
const GrpcPanel = lazy(() =>
  import("@/components/GrpcPanel").then((m) => ({ default: m.GrpcPanel })),
);

type TabKey = "collections" | "grpc" | "env";

const TABS: { key: TabKey; label: MessageKey; icon: typeof FolderTree }[] = [
  { key: "collections", label: "apis", icon: FolderTree },
  { key: "grpc", label: "grpc", icon: Network },
  { key: "env", label: "envShort", icon: Settings2 },
];

export function Sidebar() {
  const { t } = useI18n();
  const tab = useStore((s) => s.sidebarTab) as TabKey;
  const setTab = useStore((s) => s.setSidebarTab);
  const open = useStore((s) => s.sidebarOpen);
  const width = useStore((s) => s.sidebarWidth);
  const setWidth = useStore((s) => s.setSidebarWidth);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const hasGrpc = useStore((s) => s.features.grpc !== false);
  const tabs = TABS.filter((x) => x.key !== "grpc" || hasGrpc);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => setWidth(ev.clientX);
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
      style={{ ["--sbw" as string]: `${width}px` }}
      className={cn(
        "absolute inset-y-0 left-0 z-30 flex w-[86vw] max-w-[320px] shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-transform duration-200",
        "md:static md:max-w-none md:translate-x-0 md:w-[var(--sbw)]",
        open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        collapsed && "md:hidden",
      )}
    >
      <div
        className="grid shrink-0 items-center gap-1 border-b p-1.5"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0,1fr))` }}
      >
        {tabs.map((item) => (
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
        {tab === "grpc" && (
          <Suspense fallback={null}>
            <GrpcPanel />
          </Suspense>
        )}
        {tab === "env" && <EnvPanel />}
      </div>

      {/* Drag to resize (desktop only) */}
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        className="absolute inset-y-0 -right-1 z-40 hidden w-2 cursor-col-resize hover:bg-primary/20 md:block"
      />
    </aside>
  );
}
