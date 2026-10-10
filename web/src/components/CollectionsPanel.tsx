import { useState, type DragEvent } from "react";
import {
  ChevronRight,
  Copy,
  Download,
  FileCode2,
  FileText,
  Folder,
  FolderCog,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Link2,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PromptDialog } from "@/components/PromptDialog";
import { cn, copyText, downloadURL, shortMethod } from "@/lib/utils";
import { findNode, useStore } from "@/store";
import type { CollectionNode } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { FolderSettingsDialog, MoveDialog } from "@/components/FolderSettingsDialog";
import { RunDialog, type RunItem } from "@/components/RunDialog";
import { DocExportDialog } from "@/components/DocExportDialog";

type DropPosition = "before" | "after" | "inside" | "dependency";
type DropTarget = { id: string; position: DropPosition };

export function CollectionsPanel() {
  const collections = useStore((s) => s.collections);
  const selectedFolderId = useStore((s) => s.selectedFolderId);
  const selectFolder = useStore((s) => s.selectFolder);
  const createFolder = useStore((s) => s.createFolder);
  const createRequest = useStore((s) => s.createRequest);
  const renameNode = useStore((s) => s.renameNode);
  const deleteNode = useStore((s) => s.deleteNode);
  const moveNode = useStore((s) => s.moveNode);
  const addDependency = useStore((s) => s.addDependency);
  const duplicateNode = useStore((s) => s.duplicateNode);
  const openNode = useStore((s) => s.openNode);
  const toast = useStore((s) => s.toast);
  const { t } = useI18n();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");
  const [folderSettings, setFolderSettings] = useState<CollectionNode | null>(null);
  const [moveTarget, setMoveTarget] = useState<CollectionNode | null>(null);
  const [runScope, setRunScope] = useState<{ title: string; items: RunItem[]; defaultRepeat: number } | null>(null);
  const [docNode, setDocNode] = useState<CollectionNode | null>(null);
  const [docOpen, setDocOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const [dialog, setDialog] = useState<
    | { kind: "folder"; parentId: string }
    | { kind: "request"; parentId: string }
    | { kind: "rename"; node: CollectionNode }
    | null
  >(null);

  const isOpen = (id: string) => expanded[id] ?? true;

  const newRequestAndOpen = async (parentId: string, name: string) => {
    const id = await createRequest(name, parentId);
    if (!id) return;
    const node = findNode(useStore.getState().collections, id);
    if (node) openNode(node);
    if (parentId) setExpanded((e) => ({ ...e, [parentId]: true }));
  };

  const performDrop = (target: CollectionNode, parentId: string, position: DropPosition) => {
    const src = dragId;
    setDragId(null);
    setDropTarget(null);
    if (!src || src === target.id) return;
    if (position === "dependency") {
      void addDependency(src, target.id);
      return;
    }
    if (position === "inside") {
      void moveNode(src, target.id, "", "after");
      setExpanded((e) => ({ ...e, [target.id]: true }));
    } else {
      void moveNode(src, parentId, target.id, position);
    }
  };

  const dragType = dragId ? (findNode(collections, dragId)?.type ?? null) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b p-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("searchRequests")}
          className="h-8 text-xs"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          title={t("newRequest")}
          onClick={() => setDialog({ kind: "request", parentId: selectedFolderId ?? "" })}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          title={t("newFolder")}
          onClick={() => setDialog({ kind: "folder", parentId: selectedFolderId ?? "" })}
        >
          <FolderPlus className="h-4 w-4" />
        </Button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          // Dropping on empty space moves the node to the root.
          e.preventDefault();
          if (!dragId) return;
          void moveNode(dragId, "", "", "after");
          setDragId(null);
          setDropTarget(null);
        }}
      >
        {collections.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            {t("collectionsEmpty")}
          </div>
        )}
        {collections.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            parentId=""
            filter={filter.trim().toLowerCase()}
            isOpen={isOpen}
            toggle={(id) => setExpanded((e) => ({ ...e, [id]: !isOpen(id) }))}
            selectedFolderId={selectedFolderId}
            onSelectFolder={(id) => selectFolder(id)}
            onOpenRequest={(n) => openNode(n)}
            dragId={dragId}
            dragType={dragType}
            dropTarget={dropTarget}
            onDragStart={setDragId}
            onDragOver={setDropTarget}
            onDragEnd={() => {
              setDragId(null);
              setDropTarget(null);
            }}
            onDropNode={performDrop}
            onMenu={(kind, n) => {
              if (kind === "rename") setDialog({ kind: "rename", node: n });
              if (kind === "delete") {
                if (confirm(t("deleteNodeConfirm", { name: n.name }))) void deleteNode(n.id);
              }
              if (kind === "duplicate") void duplicateNode(n.id);
              if (kind === "folder-settings") setFolderSettings(n);
              if (kind === "move") setMoveTarget(n);
              if (kind === "run-concurrent") setRunScope({ title: n.name, items: collectRunItems(n, ""), defaultRepeat: 1 });
              if (kind === "load-test" && n.request) setRunScope({ title: n.name, items: [{ name: n.name, request: n.request }], defaultRepeat: 10 });
              if (kind === "copy-curl" && n.request) {
                void api.generateCurl(n.request).then(async ({ command }) => {
                  if (await copyText(command)) toast({ title: t("copiedToClipboard"), variant: "success" });
                });
              }
              if (kind === "export-json") downloadURL(`/api/export?id=${encodeURIComponent(n.id)}&format=curlui`);
              if (kind === "export-curl") downloadURL(`/api/export?id=${encodeURIComponent(n.id)}&format=curl`);
              if (kind === "export-docs") {
                setDocNode(n);
                setDocOpen(true);
              }
              if (kind === "new-request") setDialog({ kind: "request", parentId: n.id });
              if (kind === "new-folder") setDialog({ kind: "folder", parentId: n.id });
            }}
          />
        ))}
      </div>

      <PromptDialog
        open={dialog?.kind === "folder"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("newFolder")}
        defaultValue={t("newFolder")}
        submitLabel={t("create")}
        onSubmit={(v) => v && createFolder(v, dialog?.kind === "folder" ? dialog.parentId : "")}
      />
      <PromptDialog
        open={dialog?.kind === "request"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("newRequest")}
        defaultValue={t("newRequest")}
        submitLabel={t("create")}
        onSubmit={(v) => v && newRequestAndOpen(dialog?.kind === "request" ? dialog.parentId : "", v)}
      />
      <PromptDialog
        open={dialog?.kind === "rename"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("rename")}
        defaultValue={dialog?.kind === "rename" ? dialog.node.name : ""}
        submitLabel={t("rename")}
        onSubmit={(v) => {
          if (dialog?.kind === "rename" && v) void renameNode(dialog.node.id, v);
        }}
      />

      <FolderSettingsDialog
        open={folderSettings !== null}
        onOpenChange={(o) => !o && setFolderSettings(null)}
        folder={folderSettings}
      />
      <MoveDialog
        open={moveTarget !== null}
        onOpenChange={(o) => !o && setMoveTarget(null)}
        node={moveTarget}
      />
      <RunDialog
        open={runScope !== null}
        onOpenChange={(o) => !o && setRunScope(null)}
        title={runScope?.title ?? ""}
        items={runScope?.items ?? []}
        defaultRepeat={runScope?.defaultRepeat ?? 1}
      />
      <DocExportDialog open={docOpen} onOpenChange={setDocOpen} node={docNode} />
    </div>
  );
}

type TreeNodeProps = {
  node: CollectionNode;
  depth: number;
  parentId: string;
  filter: string;
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  selectedFolderId: string | null;
  onSelectFolder: (id: string) => void;
  onOpenRequest: (node: CollectionNode) => void;
  dragId: string | null;
  dragType: "folder" | "request" | null;
  dropTarget: DropTarget | null;
  onDragStart: (id: string) => void;
  onDragOver: (target: DropTarget | null) => void;
  onDragEnd: () => void;
  onDropNode: (target: CollectionNode, parentId: string, position: DropPosition) => void;
  onMenu: (
    kind:
      | "rename"
      | "delete"
      | "new-request"
      | "new-folder"
      | "duplicate"
      | "copy-curl"
      | "export-json"
      | "export-curl"
      | "export-docs"
      | "folder-settings"
      | "run-concurrent"
      | "load-test"
      | "move",
    node: CollectionNode,
  ) => void;
};

function TreeNode(props: TreeNodeProps) {
  const {
    node,
    depth,
    parentId,
    filter,
    isOpen,
    toggle,
    selectedFolderId,
    onSelectFolder,
    onOpenRequest,
    dragId,
    dragType,
    dropTarget,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDropNode,
    onMenu,
  } = props;
  const { t } = useI18n();
  const status = useStore((s) => s.testStatus[node.id]);

  const matches =
    !filter ||
    node.name.toLowerCase().includes(filter) ||
    (node.request?.url.toLowerCase().includes(filter) ?? false);
  const subtreeMatches = matches || JSON.stringify(node).toLowerCase().includes(filter);
  if (filter && !subtreeMatches) return null;

  const isFolder = node.type === "folder";
  const padding = { paddingLeft: `${depth * 14 + 6}px` };
  const isDragging = dragId === node.id;
  const isDropTarget = dropTarget?.id === node.id;
  // Disallow dropping a node into its own subtree.
  const canDrop = dragId && dragId !== node.id && !containsNode(node, dragId);

  const computePosition = (e: DragEvent): DropPosition => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    if (isFolder) {
      if (ratio < 0.28) return "before";
      if (ratio > 0.72) return "after";
      return "inside";
    }
    if (dragType === "request") {
      if (ratio < 0.33) return "before";
      if (ratio > 0.66) return "after";
      return "dependency";
    }
    return ratio < 0.5 ? "before" : "after";
  };

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", node.id);
          onDragStart(node.id);
        }}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          if (!canDrop) return;
          e.preventDefault();
          e.stopPropagation();
          onDragOver({ id: node.id, position: computePosition(e) });
        }}
        onDragLeave={(e) => {
          if (dropTarget?.id === node.id) onDragOver(null);
        }}
        onDrop={(e) => {
          if (!canDrop) return;
          e.preventDefault();
          e.stopPropagation();
          onDropNode(node, parentId, computePosition(e));
        }}
        className={cn(
          "tree-row group flex items-center gap-1 rounded-md py-1 pr-1 text-sm hover:bg-sidebar-accent/70",
          isFolder && selectedFolderId === node.id && "bg-sidebar-accent",
          isDragging && "dragging",
          isDropTarget && dropTarget?.position === "inside" && "drop-inside",
          isDropTarget && dropTarget?.position === "before" && "drop-before",
          isDropTarget && dropTarget?.position === "after" && "drop-after",
          isDropTarget && dropTarget?.position === "dependency" && "drop-depend",
        )}
        style={padding}
        onClick={() => {
          if (isFolder) {
            onSelectFolder(node.id);
            toggle(node.id);
          } else {
            onOpenRequest(node);
          }
        }}
      >
        {isFolder ? (
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              isOpen(node.id) && "rotate-90",
            )}
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.id);
            }}
          />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        {isFolder ? (
          isOpen(node.id) ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400/80" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400/80" />
          )
        ) : (
          <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}

        <span className="min-w-0 flex-1 truncate">{node.name}</span>

        {isFolder && (node.setupNodeId || (node.variables?.length ?? 0) > 0) && (
          <FolderCog className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}

        {!isFolder && (node.request?.dependsOn?.length ?? 0) > 0 && (
          <span title={`${t("hasDependency")} (${node.request?.dependsOn?.length})`}>
            <Link2 className="h-3 w-3 shrink-0 text-sky-400" />
          </span>
        )}

        {!isFolder && status && (
          <span
            title={status === "pass" ? t("statusPassed") : t("statusFailed")}
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              status === "pass" ? "bg-emerald-400" : "bg-red-400",
            )}
          />
        )}

        {!isFolder && node.request && (
          <span
            title={node.request.method}
            className={cn("shrink-0 text-[10px] font-semibold", `method-${node.request.method}`)}
          >
            {shortMethod(node.request.method)}
          </span>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 hover:bg-accent group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
            {isFolder && (
              <>
                <DropdownMenuItem onClick={() => onMenu("new-request", node)}>
                  <Plus /> {t("newRequest")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMenu("new-folder", node)}>
                  <FolderPlus /> {t("newFolder")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMenu("folder-settings", node)}>
                  <FolderCog /> {t("folderSettings")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMenu("run-concurrent", node)}>
                  <Play /> {t("runConcurrently")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => onMenu("rename", node)}>
              <Pencil /> {t("rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMenu("duplicate", node)}>
              <Copy /> {t("duplicate")}
            </DropdownMenuItem>
            {!isFolder && (
              <DropdownMenuItem onClick={() => onMenu("copy-curl", node)}>
                <Terminal /> {t("copyAsCurl")}
              </DropdownMenuItem>
            )}
            {!isFolder && (
              <DropdownMenuItem onClick={() => onMenu("load-test", node)}>
                <Play /> {t("loadTest")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onMenu("move", node)}>
              <FolderInput /> {t("moveTo")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onMenu("export-json", node)}>
              <Download /> {t("exportJson")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMenu("export-curl", node)}>
              <Download /> {t("exportCurl")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMenu("export-docs", node)}>
              <FileText /> {t("exportDocs")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => onMenu("delete", node)}>
              <Trash2 /> {t("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isFolder && isOpen(node.id) && (node.children ?? []).length > 0 && (
        <div>
          {(node.children ?? []).map((child) => (
            <TreeNode key={child.id} {...props} node={child} depth={depth + 1} parentId={node.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function containsNode(node: CollectionNode, id: string): boolean {
  if (node.id === id) return true;
  for (const c of node.children ?? []) {
    if (containsNode(c, id)) return true;
  }
  return false;
}

// collectRunItems flattens a node's requests for the concurrent runner.
function collectRunItems(node: CollectionNode, prefix: string): RunItem[] {
  const out: RunItem[] = [];
  const name = prefix ? `${prefix} / ${node.name}` : node.name;
  if (node.type === "request" && node.request) {
    out.push({ name, request: node.request });
  }
  for (const c of node.children ?? []) {
    out.push(...collectRunItems(c, name));
  }
  return out;
}
