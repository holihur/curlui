import { useEffect, useState } from "react";import {
  Braces,
  FileJson2,
  FileUp,
  Globe,
  Menu,
  Moon,
  Plus,
  Sun,
  TerminalSquare,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImportCurlDialog } from "@/components/ImportCurlDialog";
import { OpenAPIDialog } from "@/components/OpenAPIDialog";
import { LOCALES, useI18n } from "@/lib/i18n";
import { useStore } from "@/store";

const NONE = "__none__";

export function TopBar() {
  const { t, locale, setLocale, theme, toggleTheme } = useI18n();
  const environments = useStore((s) => s.environments);
  const activeEnvId = useStore((s) => s.activeEnvId);
  const setActiveEnv = useStore((s) => s.setActiveEnv);
  const newTab = useStore((s) => s.newTab);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const [importOpen, setImportOpen] = useState(false);
  const [openapiOpen, setOpenapiOpen] = useState(false);

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

      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => newTab()}>
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">{t("new")}</span>
      </Button>
      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}>
        <FileUp className="h-4 w-4" />
        <span className="hidden sm:inline">{t("importCurl")}</span>
      </Button>
      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setOpenapiOpen(true)}>
        <FileJson2 className="h-4 w-4" />
        <span className="hidden lg:inline">{t("importOpenapi")}</span>
      </Button>

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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" title={t("language")}>
              <Globe className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {LOCALES.map((l) => (
              <DropdownMenuItem
                key={l.value}
                onClick={() => setLocale(l.value)}
                className={l.value === locale ? "text-primary" : ""}
              >
                {l.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleTheme}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("toggleTheme")}</TooltipContent>
        </Tooltip>

        <Braces className="hidden h-4 w-4 text-muted-foreground md:block" />
      </div>

      <ImportCurlDialog open={importOpen} onOpenChange={setImportOpen} />
      <OpenAPIDialog open={openapiOpen} onOpenChange={setOpenapiOpen} />
    </header>
  );
}
