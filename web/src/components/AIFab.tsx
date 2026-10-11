import { useRef } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/store";

// AIFab is the bottom-right shortcut that wakes the assistant. Like the
// feedback button it can be dragged anywhere and remembers where it was put.
export function AIFab() {
  const { t } = useI18n();
  const setAiOpen = useStore((s) => s.setAiOpen);
  const pos = useStore((s) => s.aiPos);
  const setPos = useStore((s) => s.setAiPos);
  const ref = useRef<HTMLButtonElement>(null);
  const dragged = useRef(false);

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = ref.current?.getBoundingClientRect();
    const offX = e.clientX - (rect?.left ?? 0);
    const offY = e.clientY - (rect?.top ?? 0);
    const startX = e.clientX;
    const startY = e.clientY;
    dragged.current = false;
    const onMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) dragged.current = true;
      setPos({
        x: Math.min(Math.max(ev.clientX - offX, 4), window.innerWidth - 48),
        y: Math.min(Math.max(ev.clientY - offY, 4), window.innerHeight - 48),
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setTimeout(() => (dragged.current = false), 0);
    };
    document.body.style.cursor = "grabbing";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <button
      ref={ref}
      onMouseDown={onDown}
      onClick={() => {
        if (!dragged.current) setAiOpen(true);
      }}
      title={t("aiChat")}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={cn(
        "fixed z-40 flex h-11 w-11 cursor-grab items-center justify-center rounded-full bg-violet-600 text-white shadow-lg transition-transform hover:scale-105 active:cursor-grabbing",
        // Sits just above the feedback button by default.
        !pos && "bottom-[4.5rem] right-4",
      )}
    >
      <Sparkles className="h-5 w-5" />
    </button>
  );
}
