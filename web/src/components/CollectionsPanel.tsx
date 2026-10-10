import { useState } from "react";
import {
  ChevronRight,
  Copy,
  FileCode2,
  Folder,
  FolderCog,
  FolderInput,
  FolderOpen,
  FolderPlus,
  MoreVertical,
  Pencil,
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
import { cn, copyText } from "@/lib/utils";
import { findNode, useStore } from "@/store";
import type { CollectionNode } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { FolderSettingsDialog, MoveDialog } from "@/components/FolderSettingsDialog";

export function CollectionsPanel() {
  const collections = useStore((s) => s.collections);
  const selectedFolderId = useStore((s) => s.selectedFolderId);
  const selectFolder = useStore((s) => s.selectFolder);
  const createFolder = useStore((s) => s.createFolder);
  const createRequest = useStore((s) => s.createRequest);
  const renameNode = useStore((s) => s.renameNode);
  const deleteNode = useStore((s) => s.deleteNode);
  const openNode = useStore((s) => s.openNode);
  const duplicateNode = useStore((s) => s.duplicateNode);
  const toast = useStore((s) => s.toast);
  const { t } = useI18n();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<
    | { kind: "folder"; parentId: string }
    | { kind: "request"; parentId: string }
    | { kind: "rename"; node: CollectionNode }
    | null
  >(null);

  const [filter, setFilter] = useState("");
  const [folderSettings, setFolderSettings] = useState<CollectionNode | null>(null);
  const [moveTarget, setMoveTarget] = useState<CollectionNode | null>(null);

  const isOpen = (id: string) => expanded[id] ?? true;

  const newRequestAndOpen = async (parentId: string, name: string) => {
    const id = await createRequest(name, parentId);
    if (!id) return;
    const node = findNode(useStore.getState().collections, id);
    if (node) openNode(node);
    if (parentId) setExpanded((e) => ({ ...e, [parentId]: true }));
    else openNodeFallback(id);
  };

  const openNodeFallback = (id: string) => {
    const node = findNode(useStore.getState().collections, id);
    if (node) openNode(node);
  };

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

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
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
            filter={filter.trim().toLowerCase()}
            isOpen={isOpen}
            toggle={(id) => setExpanded((e) => ({ ...e, [id]: !isOpen(id) }))}
            selectedFolderId={selectedFolderId}
            onSelectFolder={(id) => selectFolder(id)}
            onOpenRequest={(n) => openNode(n)}
            onMenu={(kind, n) => {
              if (kind === "rename") setDialog({ kind: "rename", node: n });
              if (kind === "delete") {
                if (confirm(t("deleteNodeConfirm", { name: n.name }))) void deleteNode(n.id);
              }
              if (kind === "duplicate") void duplicateNode(n.id);
              if (kind === "folder-settings") setFolderSettings(n);
              if (kind === "move") setMoveTarget(n);
              if (kind === "copy-curl" && n.request) {
                void api.generateCurl(n.request).then(async ({ command }) => {
                  if (await copyText(command)) toast({ title: t("copiedToClipboard"), variant: "success" });
                });
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
        open={dialog?.kind === "rename"}        onOpenChange={(o) => !o && setDialog(null)}
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
    </div>
  );
}

type TreeNodeProps = {
  node: CollectionNode;
  depth: number;
  filter: string;
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  selectedFolderId: string | null;
  onSelectFolder: (id: string) => void;
  onOpenRequest: (node: CollectionNode) => void;
  onMenu: (
    kind:
      | "rename"
      | "delete"
      | "new-request"
      | "new-folder"
      | "duplicate"
      | "copy-curl"
      | "folder-settings"
      | "move",
    node: CollectionNode,
  ) => void;
};

function TreeNode(props: TreeNodeProps) {
  const { node, depth, filter, isOpen, toggle, selectedFolderId, onSelectFolder, onOpenRequest, onMenu } = props;
  const { t } = useI18n();
  const status = useStore((s) => s.testStatus[node.id]);
  const matches =
    !filter ||
    node.name.toLowerCase().includes(filter) ||
    (node.request?.url.toLowerCase().includes(filter) ?? false);
  const subtreeMatches =
    matches ||
    (node.children ?? []).some((c) => JSON.stringify(c).toLowerCase().includes(filter));

  if (filter && !subtreeMatches) return null;

  const padding = { paddingLeft: `${depth * 14 + 6}px` };
  const isFolder = node.type === "folder";

  return (
    <div>
      <div
        className={cn(
          "group flex cursor-pointer items-center gap-1 rounded-md py-1 pr-1 text-sm hover:bg-sidebar-accent/70",
          isFolder && selectedFolderId === node.id && "bg-sidebar-accent",
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
            className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen(node.id) && "rotate-90")}
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
          <span className={cn("shrink-0 text-[10px] font-semibold", `method-${node.request.method}`)}>
            {node.request.method}
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
            <DropdownMenuItem onClick={() => onMenu("move", node)}>
              <FolderInput /> {t("moveTo")}
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
            <TreeNode key={child.id} {...props} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
