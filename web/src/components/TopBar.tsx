import { lazy, Suspense, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  FileJson2,
  FileText,
  FileUp,
  FolderInput,
  FolderKanban,
  Globe,
  LogIn,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Plus,
  Settings as SettingsIcon,
  Sun,
  TerminalSquare,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PromptDialog } from "@/components/PromptDialog";

// Dialogs are loaded on demand so they stay out of the initial bundle.
const ImportCurlDialog = lazy(() =>
  import("@/components/ImportCurlDialog").then((m) => ({ default: m.ImportCurlDialog })),
);
const OpenAPIDialog = lazy(() =>
  import("@/components/OpenAPIDialog").then((m) => ({ default: m.OpenAPIDialog })),
);
const SettingsDialog = lazy(() =>
  import("@/components/SettingsDialog").then((m) => ({ default: m.SettingsDialog })),
);
const DocExportDialog = lazy(() =>
  import("@/components/DocExportDialog").then((m) => ({ default: m.DocExportDialog })),
);
const TeamDialog = lazy(() =>
  import("@/components/TeamDialog").then((m) => ({ default: m.TeamDialog })),
);
const LoginDialog = lazy(() =>
  import("@/components/LoginDialog").then((m) => ({ default: m.LoginDialog })),
);
import { LOCALES, useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useStore } from "@/store";

const NONE = "__none__";

export function TopBar() {
  const { t, locale, setLocale, theme, setTheme } = useI18n();
  const environments = useStore((s) => s.environments);
  const activeEnvId = useStore((s) => s.activeEnvId);
  const setActiveEnv = useStore((s) => s.setActiveEnv);
  const newTab = useStore((s) => s.newTab);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const selectedFolderId = useStore((s) => s.selectedFolderId);
  const refreshCollections = useStore((s) => s.refreshCollections);
  const toast = useStore((s) => s.toast);

  const [importOpen, setImportOpen] = useState(false);
  const [openapiOpen, setOpenapiOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const collectionFileRef = useRef<HTMLInputElement>(null);
  const postmanFileRef = useRef<HTMLInputElement>(null);

  const projects = useStore((s) => s.projects);
  const projectId = useStore((s) => s.projectId);
  const setProject = useStore((s) => s.setProject);
  const createProject = useStore((s) => s.createProject);
  const user = useStore((s) => s.user);
  const authEnabled = useStore((s) => s.authEnabled);
  const authenticated = useStore((s) => s.authenticated);
  const logout = useStore((s) => s.logout);
  const setLoginOpen = useStore((s) => s.setLoginOpen);
  const loginOpen = useStore((s) => s.loginOpen);
  const currentProject = projects.find((p) => p.id === projectId);

  const importCollection = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const nodes = Array.isArray(parsed) ? parsed : parsed.collections;
      if (!Array.isArray(nodes) || nodes.length === 0) throw new Error("no collections found");
      const { count } = await api.importCollections(selectedFolderId ?? "", nodes);
      await refreshCollections();
      toast({ title: `${t("imported")}: ${count}`, variant: "success" });
    } catch (err) {
      toast({
        title: t("importFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
  };

  const importPostmanFile = async (file: File) => {
    try {
      const { count } = await api.importPostman(await file.text(), selectedFolderId ?? "");
      await refreshCollections();
      toast({ title: `${t("imported")}: ${count}`, variant: "success" });
    } catch (err) {
      toast({
        title: t("importFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-2 sm:px-3">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 md:hidden"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        title="Menu"
      >
        <Menu className="h-4 w-4" />
      </Button>

      <div className="flex select-none items-center gap-2 pr-1 sm:pr-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <TerminalSquare className="h-4 w-4" />
        </div>
        <span className="hidden text-sm font-semibold tracking-tight sm:inline">curlui</span>
      </div>

      <div className="hidden h-6 w-px bg-border sm:block" />

      {/* New + Import in one menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t("new")}</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => newTab()}>
            <Plus /> {t("newRequest")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setImportOpen(true)}>
            <FileUp /> {t("importCurl")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpenapiOpen(true)}>
            <FileJson2 /> {t("importOpenapi")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => collectionFileRef.current?.click()}>
            <FolderInput /> {t("importCollection")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => postmanFileRef.current?.click()}>
            <FileJson2 /> {t("importPostman")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Project switcher */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="max-w-[11rem] gap-1.5" title={t("switchProject")}>
            <FolderKanban className="h-4 w-4" />
            <span className="hidden truncate sm:inline">{currentProject?.name ?? projectId}</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>{t("projects")}</DropdownMenuLabel>
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => void setProject(p.id)}>
              {p.id === projectId ? <Check /> : <FolderKanban />}
              <span className="truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNewProjectOpen(true)}>
            <Plus /> {t("newProject")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        <div className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:flex">
          <Zap className="h-3.5 w-3.5" />
          {t("environment")}
        </div>
        <Select value={activeEnvId ?? NONE} onValueChange={(v) => setActiveEnv(v === NONE ? null : v)}>
          <SelectTrigger className="h-8 w-28 text-xs sm:w-40 lg:w-48">
            <SelectValue placeholder={t("noEnvironment")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("noEnvironment")}</SelectItem>
            {environments.map((env) => (
              <SelectItem key={env.id} value={env.id}>
                {env.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Theme, language and settings in one "…" menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" title={t("more")}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {/* Primary actions first */}
            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <SettingsIcon /> {t("settings")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTeamOpen(true)}>
              <Users /> {t("team")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDocOpen(true)}>
              <FileText /> {t("exportDocs")}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Account */}
            <DropdownMenuLabel>{t("account")}</DropdownMenuLabel>
            {user && (
              <DropdownMenuItem disabled>
                {user.name || user.username} · {user.role}
              </DropdownMenuItem>
            )}
            {authEnabled && authenticated && (
              <DropdownMenuItem onClick={() => void logout()}>
                <LogOut /> {t("logout")}
              </DropdownMenuItem>
            )}
            {authEnabled && !authenticated && (
              <DropdownMenuItem onClick={() => setLoginOpen(true)}>
                <LogIn /> {t("login")}
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            {/* Preferences last, in submenus */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {theme === "dark" ? <Moon /> : <Sun />} {t("theme")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => setTheme("light")}>
                  {theme === "light" ? <Check /> : <Sun />} {t("themeLight")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("dark")}>
                  {theme === "dark" ? <Check /> : <Moon />} {t("themeDark")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Globe /> {t("language")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {LOCALES.map((l) => (
                  <DropdownMenuItem key={l.value} onClick={() => setLocale(l.value)}>
                    {locale === l.value ? <Check /> : <Globe />} {l.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {importOpen && (
        <Suspense fallback={null}>
          <ImportCurlDialog open onOpenChange={setImportOpen} />
        </Suspense>
      )}
      {openapiOpen && (
        <Suspense fallback={null}>
          <OpenAPIDialog open onOpenChange={setOpenapiOpen} />
        </Suspense>
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog open onOpenChange={setSettingsOpen} />
        </Suspense>
      )}
      {docOpen && (
        <Suspense fallback={null}>
          <DocExportDialog open onOpenChange={setDocOpen} node={null} />
        </Suspense>
      )}
      {teamOpen && (
        <Suspense fallback={null}>
          <TeamDialog open onOpenChange={setTeamOpen} />
        </Suspense>
      )}
      {loginOpen && (
        <Suspense fallback={null}>
          <LoginDialog open onOpenChange={setLoginOpen} />
        </Suspense>
      )}
      <PromptDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        title={t("newProject")}
        placeholder={t("projectName")}
        submitLabel={t("save")}
        onSubmit={(v) => {
          if (v.trim()) void createProject(v.trim());
        }}
      />
      <input
        ref={collectionFileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importCollection(f);
          e.target.value = "";
        }}
      />
      <input
        ref={postmanFileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importPostmanFile(f);
          e.target.value = "";
        }}
      />
    </header>
  );
}
