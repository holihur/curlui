import { useEffect, useRef } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopBar } from "@/components/TopBar";
import { Sidebar } from "@/components/Sidebar";
import { RequestTabs } from "@/components/RequestTabs";
import { RequestEditor } from "@/components/RequestEditor";
import { Toaster } from "@/components/Toaster";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";

export default function App() {
  const loadAll = useStore((s) => s.loadAll);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void loadAll();
  }, [loadAll]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-full flex-col overflow-x-hidden bg-background text-foreground">
        <TopBar />
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div
            className={cn(
              "absolute inset-0 z-20 bg-black/50 backdrop-blur-sm md:hidden",
              sidebarOpen ? "block" : "hidden",
            )}
            onClick={() => setSidebarOpen(false)}
          />
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <RequestTabs />
            <RequestEditor />
          </main>
        </div>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
