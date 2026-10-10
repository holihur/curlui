import { useState } from "react";
import { Check, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyValueEditor } from "@/components/KeyValueEditor";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/store";
import type { Environment } from "@/lib/types";

export function EnvPanel() {
  const { t } = useI18n();
  const environments = useStore((s) => s.environments);
  const activeEnvId = useStore((s) => s.activeEnvId);
  const setActiveEnv = useStore((s) => s.setActiveEnv);
  const saveEnvironment = useStore((s) => s.saveEnvironment);
  const deleteEnvironment = useStore((s) => s.deleteEnvironment);

  const [draft, setDraft] = useState<Environment | null>(null);

  const startNew = () => setDraft({ id: "", name: t("newEnvironment"), variables: [] });
  const startEdit = (env: Environment) => setDraft(JSON.parse(JSON.stringify(env)));

  const save = async () => {
    if (!draft) return;
    const saved = await saveEnvironment(draft);
    if (saved) setDraft(JSON.parse(JSON.stringify(saved)));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{t("variables")}</span>
        <Button variant="ghost" size="xs" className="gap-1" onClick={startNew}>
          <Plus className="h-3.5 w-3.5" /> {t("new")}
        </Button>
      </div>

      <div className="max-h-52 overflow-y-auto p-1">
        {environments.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t("envEmpty")}</div>
        )}
        {environments.map((env) => (
          <div
            key={env.id}
            className={cn(
              "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent/70",
              draft?.id === env.id && "bg-sidebar-accent",
            )}
            onClick={() => startEdit(env)}
          >
            <button
              title={activeEnvId === env.id ? "Active" : "Set active"}
              onClick={(e) => {
                e.stopPropagation();
                setActiveEnv(activeEnvId === env.id ? null : env.id);
              }}
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                activeEnvId === env.id ? "border-success bg-success text-white" : "border-input",
              )}
            >
              {activeEnvId === env.id && <Check className="h-2.5 w-2.5" />}
            </button>
            <span className="min-w-0 flex-1 truncate">{env.name}</span>
            <span className="text-[10px] text-muted-foreground">
              {t("varsCount", { n: env.variables.length })}
            </span>
          </div>
        ))}
      </div>

      {draft && (
        <div className="flex min-h-0 flex-1 flex-col border-t">
          <div className="flex items-center gap-2 border-b p-2">
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="h-8 flex-1 text-sm"
              placeholder={t("envName")}
            />
            <Button size="icon" className="h-8 w-8" title={t("saveTooltip")} onClick={save}>
              <Save className="h-4 w-4" />
            </Button>
            {draft.id && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                title={t("deleted")}
                onClick={() => {
                  if (confirm(t("envDeleteConfirm", { name: draft.name }))) {
                    void deleteEnvironment(draft.id);
                    setDraft(null);
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <KeyValueEditor
              items={draft.variables}
              onChange={(variables) => setDraft({ ...draft, variables })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
