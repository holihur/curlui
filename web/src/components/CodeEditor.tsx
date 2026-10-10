import { useRef } from "react";
import { highlightJSON } from "@/lib/highlight";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange?: (value: string) => void;
  language?: "json" | "text";
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
};

/**
 * A lightweight code editor: a transparent <textarea> layered over a
 * syntax-highlighted <pre>. Keeps the bundle dependency-free while giving the
 * feel of a real code editor.
 */
export function CodeEditor({
  value,
  onChange,
  language = "text",
  placeholder,
  readOnly,
  className,
}: Props) {
  const preRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const sync = () => {
    if (!preRef.current || !taRef.current) return;
    preRef.current.scrollTop = taRef.current.scrollTop;
    preRef.current.scrollLeft = taRef.current.scrollLeft;
  };

  const content = language === "json" ? highlightJSON(value) : value;

  return (
    <div className={cn("relative overflow-hidden bg-background", className)}>
      <pre
        ref={preRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre p-3 font-mono text-xs leading-[1.6] text-foreground"
      >
        {content}
        {"\n"}
      </pre>
      <textarea
        ref={taRef}
        value={value}
        readOnly={readOnly}
        wrap="off"
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        onScroll={sync}
        onKeyDown={(e) => {
          if (e.key === "Tab" && !readOnly) {
            e.preventDefault();
            const ta = e.currentTarget;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            onChange?.(value.slice(0, start) + "  " + value.slice(end));
            requestAnimationFrame(() => {
              ta.selectionStart = ta.selectionEnd = start + 2;
            });
          }
        }}
        className={cn(
          "relative h-full w-full resize-none overflow-auto whitespace-pre bg-transparent p-3 font-mono text-xs leading-[1.6] outline-none",
          "text-transparent caret-foreground selection:bg-primary/25 placeholder:text-muted-foreground",
          readOnly && "cursor-default",
        )}
      />
    </div>
  );
}
