import { useRef } from "react";
import { MessageSquare, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/store";

// FloatingDock is the single bottom-right control: the assistant and the
// feedback panel share one pill, so they read as one widget. The whole group
// can be dragged and remembers where it was left.
export function FloatingDock() {
  const { t } = useI18n();
  const hasAI = useStore((s) => s.features.ai !== false);
  const feedbackHidden = useStore((s) => s.feedbackHidden);
  const pos = useStore((s) => s.feedbackPos);
  const rightOpen = useStore((s) => s.rightOpen);
  const rightWidth = useStore((s) => s.rightWidth);
  const setPos = useStore((s) => s.setFeedbackPos);
  const setRightTab = useStore((s) => s.setRightTab);
  const setFeedbackOpen = useStore((s) => s.setFeedbackOpen);
  const ref = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);

  if (!hasAI && feedbackHidden) return null;

  const onDown = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    const offX = e.clientX - (rect?.left ?? 0);
    const offY = e.clientY - (rect?.top ?? 0);
    const startX = e.clientX;
    const startY = e.clientY;
    dragged.current = false;
    const onMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) dragged.current = true;
      setPos({
        x: Math.min(Math.max(ev.clientX - offX, 4), window.innerWidth - 52),
        y: Math.min(Math.max(ev.clientY - offY, 4), window.innerHeight - 52),
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

  const click = (fn: () => void) => () => {
    if (!dragged.current) fn();
  };

  const btn =
    "flex h-10 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

  return (
    <div
      ref={ref}
      onMouseDown={onDown}
      style={
        pos
          ? { left: pos.x, top: pos.y }
          : rightOpen
            ? { right: rightWidth + 16 }
            : undefined
      }
      className={cn(
        "fixed z-40 flex cursor-grab flex-col overflow-hidden rounded-full border bg-card text-card-foreground shadow-lg active:cursor-grabbing",
        !pos && "bottom-4",
        !pos && !rightOpen && "right-4",
      )}
    >
      {hasAI && (
        <button
          type="button"
          onClick={click(() => setRightTab("ai"))}
          title={t("aiChat")}
          className={cn(btn, "text-primary hover:text-primary")}
        >
          <Sparkles className="h-[18px] w-[18px]" />
        </button>
      )}
      {!feedbackHidden && (
        <button
          type="button"
          onClick={click(() => setFeedbackOpen(true))}
          title={t("feedback")}
          className={cn(btn, hasAI && "border-t")}
        >
          <MessageSquare className="h-[18px] w-[18px]" />
        </button>
      )}
    </div>
  );
}
