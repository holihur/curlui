import { useCallback, useEffect, useState } from "react";
import { Play, RefreshCw, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatMs, relativeTime, statusColor } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useStore } from "@/store";
import type { ScheduleJob } from "@/lib/types";

export function SchedulePanel() {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);
  const [jobs, setJobs] = useState<ScheduleJob[]>([]);

  const refresh = useCallback(async () => {
    try {
      const { jobs } = await api.listSchedules();
      setJobs(jobs ?? []);
    } catch {
      /* ignore transient errors */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (err) {
      toast({
        title: t("requestFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {jobs.length} {t("schedules")}
        </span>
        <Button variant="ghost" size="xs" className="gap-1 text-muted-foreground" onClick={() => void refresh()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {jobs.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            {t("schedulesEmpty")}
          </div>
        )}
        {jobs.map((job) => (
          <div key={job.id} className="group rounded-md px-2 py-2 hover:bg-sidebar-accent/60">
            <div className="flex items-center gap-2">
              <span className={cn("shrink-0 text-[10px] font-semibold", `method-${job.request.method}`)}>
                {job.request.method}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs">{job.name}</span>
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                  job.active ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground",
                )}
              >
                {job.active ? t("jobActive") : t("jobStopped")}
              </span>
            </div>
            <div className="mt-0.5 truncate pl-7 font-mono text-[10px] text-muted-foreground">
              {job.request.url}
            </div>
            <div className="mt-1 flex items-center gap-2 pl-7 text-[10px] text-muted-foreground">
              <span className={statusColor(job.lastStatus)}>
                {job.lastError ? t("error") : job.lastStatus || "—"}
              </span>
              <span>
                {t("jobRuns")}: {job.runs}
              </span>
              {job.lastRun ? (
                <span>
                  {t("lastRun")}: {relativeTime(job.lastRun)}
                </span>
              ) : null}
              {job.active && job.nextRun ? (
                <span>
                  {t("nextRun")}: {relativeTime(job.nextRun)}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex items-center gap-1 pl-7 opacity-0 transition-opacity group-hover:opacity-100">
              <Button variant="ghost" size="xs" className="gap-1" onClick={() => void act(() => api.runSchedule(job.id))}>
                <Play className="h-3 w-3" /> {t("runNow")}
              </Button>
              {job.active && (
                <Button variant="ghost" size="xs" className="gap-1" onClick={() => void act(() => api.cancelSchedule(job.id))}>
                  <Square className="h-3 w-3" /> {t("cancel")}
                </Button>
              )}
              <Button
                variant="ghost"
                size="xs"
                className="gap-1 text-muted-foreground hover:text-destructive"
                onClick={() => void act(() => api.deleteSchedule(job.id))}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            {job.lastError && (
              <div className="mt-0.5 truncate pl-7 text-[10px] text-destructive">{job.lastError}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
