import { useEffect, useState } from "react";
import { Loader2, LogIn, ShieldPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useStore } from "@/store";

function AuthForm({ onDone }: { onDone?: () => void }) {
  const { t } = useI18n();
  const userCount = useStore((s) => s.userCount);
  const login = useStore((s) => s.login);
  const bootstrap = useStore((s) => s.bootstrap);
  const toast = useStore((s) => s.toast);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const first = userCount === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (first) await bootstrap(username, password, name || username);
      else await login(username, password);
      onDone?.();
    } catch (err) {
      toast({
        title: first ? t("createAdmin") : t("login"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {first && <p className="text-xs text-muted-foreground">{t("firstRunHint")}</p>}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="auth-username">{t("username")}</Label>
        <Input
          id="auth-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
        />
      </div>
      {first && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="auth-name">{t("displayName")}</Label>
          <Input id="auth-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="auth-password">{t("password")}</Label>
        <Input
          id="auth-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={first ? "new-password" : "current-password"}
        />
      </div>
      <Button type="submit" disabled={busy || !username || !password} className="mt-1 gap-1.5">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : first ? (
          <ShieldPlus className="h-4 w-4" />
        ) : (
          <LogIn className="h-4 w-4" />
        )}
        {first ? t("createAdmin") : t("signIn")}
      </Button>
    </form>
  );
}

export function LoginDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("login")}</DialogTitle>
          <DialogDescription>{t("authRequired")}</DialogDescription>
        </DialogHeader>
        <AuthForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// AuthScreen is the full-page gate shown when authentication is enabled and the
// visitor is not signed in.
export function AuthScreen() {
  const { t } = useI18n();
  const [sso, setSso] = useState<{ enabled: boolean; label: string } | null>(null);

  useEffect(() => {
    api
      .oidcConfig()
      .then(setSso)
      .catch(() => setSso(null));
  }, []);

  return (
    <div className="blueprint relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* rulers */}
      <div className="blueprint-ruler-x" aria-hidden />
      <div className="blueprint-ruler-y" aria-hidden />
      <span className="absolute left-5 top-5 font-mono text-[10px] text-muted-foreground">
        curlui · artboard 1440×900
      </span>
      <span className="absolute right-5 top-5 font-mono text-[10px] text-muted-foreground">
        100%
      </span>

      {/* the artboard */}
      <div className="relative w-full max-w-sm">
        {/* crop marks */}
        <span className="artboard-mark -left-2 -top-2 border-l-2 border-t-2" aria-hidden />
        <span className="artboard-mark -right-2 -top-2 border-r-2 border-t-2" aria-hidden />
        <span className="artboard-mark -bottom-2 -left-2 border-b-2 border-l-2" aria-hidden />
        <span className="artboard-mark -bottom-2 -right-2 border-b-2 border-r-2" aria-hidden />
        {/* selection outline */}
        <span
          className="pointer-events-none absolute -inset-3 rounded-lg border border-dashed border-primary/40"
          aria-hidden
        />
        <span className="absolute -top-8 left-0 rounded bg-primary px-1.5 py-0.5 font-mono text-[10px] text-primary-foreground">
          sign-in
        </span>
        <span className="absolute -bottom-8 left-0 font-mono text-[10px] text-muted-foreground">
          w 384 · auto height
        </span>

        <div className="rounded-xl border bg-card p-6 shadow-lg">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-lg font-semibold">curlui</span>
            <span className="text-xs text-muted-foreground">· {t("team")}</span>
          </div>
          <AuthForm />
          {sso?.enabled && (
            <div className="mt-4 border-t pt-4">
              <Button
                variant="outline"
                className="w-full gap-1.5"
                onClick={() => {
                  window.location.href = "/api/auth/oidc/start";
                }}
              >
                <LogIn className="h-4 w-4" /> {t("signInWith")} {sso.label}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
