import { useEffect, useMemo, useState } from "react";
import { FolderCog, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyValueEditor } from "@/components/KeyValueEditor";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/store";
import type { CollectionNode, ExtractRule, KeyValue } from "@/lib/types";

const NONE = "__none__";

type RequestOption = { id: string; name: string; method: string; depth: number };

function collectRequests(
  nodes: CollectionNode[],
  depth = 0,
  out: RequestOption[] = [],
): RequestOption[] {
  for (const n of nodes) {
    if (n.type === "request" && n.request) {
      out.push({ id: n.id, name: n.name, method: n.request.method, depth });
    }
    if (n.children) collectRequests(n.children, depth + 1, out);
  }
  return out;
}

export function FolderSettingsDialog({
  open,
  onOpenChange,
  folder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: CollectionNode | null;
}) {
  const { t } = useI18n();
  const collections = useStore((s) => s.collections);
  const updateFolder = useStore((s) => s.updateFolder);

  const [variables, setVariables] = useState<KeyValue[]>([]);
  const [setupNodeId, setSetupNodeId] = useState<string>("");
  const [extract, setExtract] = useState<ExtractRule[]>([]);

  useEffect(() => {
    if (!open || !folder) return;
    setVariables(folder.variables ?? []);
    setSetupNodeId(folder.setupNodeId ?? "");
    setExtract(folder.extract ?? []);
  }, [open, folder]);

  const requests = useMemo(() => collectRequests(collections), [collections]);

  const save = () => {
    if (!folder) return;
    void updateFolder(folder.id, { variables, setupNodeId, extract });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderCog className="h-4 w-4" /> {t("folderSettings")}
            {folder && <span className="text-muted-foreground">· {folder.name}</span>}
          </DialogTitle>
          <DialogDescription>{t("setupRequestHint")}</DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <div>
            <div className="text-sm font-medium">{t("setupRequest")}</div>
            <div className="text-xs text-muted-foreground">{t("setupRequestHint")}</div>
          </div>
          <Select
            value={setupNodeId || NONE}
            onValueChange={(v) => setSetupNodeId(v === NONE ? "" : v)}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder={t("setupNone")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("setupNone")}</SelectItem>
              {requests.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  <span className={cn("mr-1.5 text-[10px] font-semibold", `method-${r.method}`)}>
                    {r.method}
                  </span>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>

        <section className="space-y-2">
          <div>
            <div className="text-sm font-medium">{t("extractRules")}</div>
            <div className="text-xs text-muted-foreground">{t("extractRulesHint")}</div>
          </div>
          <div className="space-y-2">
            {extract.map((rule, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={rule.name}
                  placeholder={t("extractName")}
                  onChange={(e) =>
                    setExtract(extract.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                  }
                  className="h-8 flex-1 font-mono text-xs"
                />
                <Input
                  value={rule.path}
                  placeholder={t("extractPath")}
                  onChange={(e) =>
                    setExtract(extract.map((x, i) => (i === idx ? { ...x, path: e.target.value } : x)))
                  }
                  className="h-8 flex-1 font-mono text-xs"
                />
                <button
                  onClick={() => setExtract(extract.filter((_, i) => i !== idx))}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => setExtract([...extract, { name: "", path: "", enabled: true }])}
          >
            <Plus className="h-3.5 w-3.5" /> {t("addExtract")}
          </Button>
        </section>

        <section className="space-y-2 border-t pt-4">
          <div>
            <div className="text-sm font-medium">{t("folderVariables")}</div>
            <div className="text-xs text-muted-foreground">{t("folderVariablesHint")}</div>
          </div>
          <div className="rounded-lg border">
            <KeyValueEditor items={variables} onChange={setVariables} />
          </div>
        </section>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={save}>{t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MoveDialog({
  open,
  onOpenChange,
  node,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: CollectionNode | null;
}) {
  const { t } = useI18n();
  const collections = useStore((s) => s.collections);
  const moveNode = useStore((s) => s.moveNode);
  const [parentId, setParentId] = useState<string>(NONE);

  useEffect(() => {
    if (open) setParentId(NONE);
  }, [open]);

  const folders = useMemo(() => {
    const out: { id: string; name: string; depth: number }[] = [];
    const walk = (nodes: CollectionNode[], depth: number) => {
      for (const n of nodes) {
        if (node && (n.id === node.id || isDescendantOf(n, node.id))) continue;
        if (n.type === "folder") out.push({ id: n.id, name: n.name, depth });
        if (n.children) walk(n.children, depth + 1);
      }
    };
    walk(collections, 0);
    return out;
  }, [collections, node]);

  const save = () => {
    if (!node) return;
    void moveNode(node.id, parentId === NONE ? "" : parentId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("moveTo")}</DialogTitle>
          <DialogDescription>{node?.name}</DialogDescription>
        </DialogHeader>
        <Select value={parentId} onValueChange={setParentId}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("moveRoot")}</SelectItem>
            {folders.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {"— ".repeat(f.depth)}
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={save}>{t("moveTo").replace("…", "")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isDescendantOf(node: CollectionNode, id: string): boolean {
  for (const c of node.children ?? []) {
    if (c.id === id || isDescendantOf(c, id)) return true;
  }
  return false;
}
