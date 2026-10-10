import { useEffect, useState } from "react";
import { useStore } from "@/store";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <Toast key={t.id} id={t.id} title={t.title} description={t.description} variant={t.variant} onClose={dismiss} />
      ))}
    </div>
  );
}

function Toast({
  id,
  title,
  description,
  variant = "default",
  onClose,
}: {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "success" | "error";
  onClose: (id: string) => void;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(t);
  }, []);
  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-lg border bg-popover/95 p-3 text-sm shadow-lg backdrop-blur transition-all",
        show ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        variant === "error" && "border-destructive/40",
        variant === "success" && "border-success/40",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {description && <div className="mt-0.5 break-words text-xs text-muted-foreground">{description}</div>}
      </div>
      <button
        onClick={() => onClose(id)}
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
