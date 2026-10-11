import { lazy, Suspense } from "react";
import { Activity, Maximize2, Minimize2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/store";

const TrafficPanel = lazy(() =>
  import("@/components/TrafficPanel").then((m) => ({ default: m.TrafficPanel })),
);

// BottomPanel is a resizable panel under the editor that hosts captured traffic.
export function BottomPanel() {
  const { t } = useI18n();
  const open = useStore((s) => s.bottomOpen);
  const setOpen = useStore((s) => s.setBottomOpen);
  const height = useStore((s) => s.bottomHeight);
  const setHeight = useStore((s) => s.setBottomHeight);
  const maximized = useStore((s) => s.bottomMaximized);
  const setMaximized = useStore((s) => s.setBottomMaximized);

  if (!open) return null;

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setMaximized(false);
    const onMove = (ev: MouseEvent) => setHeight(window.innerHeight - ev.clientY);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      style={{ height: maximized ? "calc(100vh - 150px)" : height }}
      className="relative flex shrink-0 flex-col border-t bg-sidebar text-sidebar-foreground"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2">
        <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{t("traffic")}</span>
        <button
          onClick={() => setMaximized(!maximized)}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={maximized ? t("restore") : t("maximize")}
        >
          {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t("close")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={null}>
          <TrafficPanel />
        </Suspense>
      </div>

      {/* Drag to resize (top edge) */}
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        className="absolute inset-x-0 -top-1 z-40 h-2 cursor-row-resize hover:bg-primary/20"
      />
    </div>
  );
}
