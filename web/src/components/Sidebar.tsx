import { useState } from "react";
import { Clock, FolderTree, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { CollectionsPanel } from "@/components/CollectionsPanel";
import { HistoryPanel } from "@/components/HistoryPanel";
import { EnvPanel } from "@/components/EnvPanel";

type TabKey = "collections" | "history" | "env";

const TABS: { key: TabKey; label: MessageKey; icon: typeof FolderTree }[] = [
  { key: "collections", label: "collections", icon: FolderTree },
  { key: "history", label: "history", icon: Clock },
  { key: "env", label: "environments", icon: Settings2 },
];

export function Sidebar() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabKey>("collections");
  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex shrink-0 items-center gap-1 border-b p-1.5">
        {TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              tab === item.key
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
            {t(item.label)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "collections" && <CollectionsPanel />}
        {tab === "history" && <HistoryPanel />}
        {tab === "env" && <EnvPanel />}
      </div>
    </aside>
  );
}
