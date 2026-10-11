import { lazy, Suspense, useEffect, useRef } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopBar } from "@/components/TopBar";
import { Sidebar } from "@/components/Sidebar";
import { RightSidebar } from "@/components/RightSidebar";
import { BottomPanel } from "@/components/BottomPanel";
import { RequestTabs } from "@/components/RequestTabs";
import { RequestEditor } from "@/components/RequestEditor";
import { Toaster } from "@/components/Toaster";
import { AuthScreen } from "@/components/LoginDialog";

const InterceptDialog = lazy(() =>
  import("@/components/InterceptDialog").then((m) => ({ default: m.InterceptDialog })),
);
import { cn } from "@/lib/utils";
import { useStore } from "@/store";

export default function App() {
  const loadAll = useStore((s) => s.loadAll);
  const applyRoute = useStore((s) => s.applyRoute);
  const newTab = useStore((s) => s.newTab);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const setRightOpen = useStore((s) => s.setRightOpen);
  const authEnabled = useStore((s) => s.authEnabled);
  const authenticated = useStore((s) => s.authenticated);
  const syncProject = useStore((s) => s.syncProject);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void loadAll().then(() => {
      applyRoute();
      if (useStore.getState().tabs.length === 0) newTab();
    });
  }, [loadAll, applyRoute, newTab]);

  useEffect(() => {
    const onHash = () => applyRoute();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [applyRoute]);

  // Collaboration: poll the shared project version and refresh when a
  // teammate changed the workspace.
  useEffect(() => {
    if (!authenticated) return;
    const id = setInterval(() => void syncProject(), 6000);
    return () => clearInterval(id);
  }, [authenticated, syncProject]);

  if (authEnabled && !authenticated) {
    return (
      <TooltipProvider delayDuration={250}>
        <AuthScreen />
        <Toaster />
      </TooltipProvider>
    );
  }

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
          <div className="flex min-w-0 flex-1 flex-col">
            <main className="flex min-h-0 flex-1 flex-col">
              <RequestTabs />
              <RequestEditor />
            </main>
            <BottomPanel />
          </div>
          {rightOpen && (
            <div
              className="absolute inset-0 z-20 bg-black/50 backdrop-blur-sm md:hidden"
              onClick={() => setRightOpen(false)}
            />
          )}
          <RightSidebar />
        </div>
        <Toaster />
        <Suspense fallback={null}>
          <InterceptDialog />
        </Suspense>
      </div>
    </TooltipProvider>
  );
}
