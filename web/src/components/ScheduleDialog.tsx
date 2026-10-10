import { useEffect, useState, type ReactNode } from "react";
import { Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { buildChain, useActiveTab, useStore } from "@/store";
import type { RequestDef } from "@/lib/types";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export function ScheduleDialog({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: RequestDef;
}) {
  const { t } = useI18n();
  const collections = useStore((s) => s.collections);
  const activeEnvId = useStore((s) => s.activeEnvId);
  const runtimeVars = useStore((s) => s.runtimeVars);
  const toast = useStore((s) => s.toast);
  const activeTab = useActiveTab();

  const [name, setName] = useState("");
  const [afterSec, setAfterSec] = useState(0);
  const [everySec, setEverySec] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    setName(request.name || "Scheduled request");
    setAfterSec(0);
    setEverySec(0);
    setCount(0);
  }, [open, request.name]);

  const create = async () => {
    const chain = buildChain(collections, activeTab?.sourceId ?? "", request);
    try {
      await api.createSchedule({
        name,
        request,
        envId: activeEnvId ?? "",
        variables: { ...chain.folderVars, ...runtimeVars },
        parents: chain.parents,
        delayMs: Math.max(0, afterSec) * 1000,
        intervalMs: Math.max(0, everySec) * 1000,
        count: Math.max(0, count),
      });
      toast({ title: t("scheduleSend"), variant: "success" });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: t("requestFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" /> {t("scheduleSend")}
          </DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">
            {request.method} {request.url}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label={t("scheduleName")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("sendAfterSeconds")}>
              <Input
                type="number"
                min={0}
                value={afterSec}
                onChange={(e) => setAfterSec(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label={t("repeatEverySeconds")}>
              <Input
                type="number"
                min={0}
                value={everySec}
                onChange={(e) => setEverySec(Number(e.target.value) || 0)}
              />
            </Field>
          </div>
          <Field label={t("repeatCount")}>
            <Input
              type="number"
              min={0}
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 0)}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void create()}>{t("createJob")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
