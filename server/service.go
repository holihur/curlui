package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const serviceName = "curlui"

// runService handles `-service <install|uninstall|status|print>`.
func runService(action, addr, dataPath string) {
	exe, err := os.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot locate executable:", err)
		os.Exit(1)
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	dataAbs, _ := filepath.Abs(dataPath)

	switch runtime.GOOS {
	case "linux":
		linuxService(action, exe, addr, dataAbs)
	case "darwin":
		launchdService(action, exe, addr, dataAbs)
	case "windows":
		windowsService(action, exe, addr, dataAbs)
	default:
		fmt.Fprintf(os.Stderr, "service mode is not supported on %s\n", runtime.GOOS)
		os.Exit(1)
	}
}

// ---------------------------------------------------------------- systemd ---

func systemdUnit(exe, addr, data string) string {
	workdir := filepath.Dir(exe)
	return fmt.Sprintf(`[Unit]
Description=curlui HTTP client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s -addr %s -data %s
WorkingDirectory=%s
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
`, exe, addr, data, workdir)
}

func linuxService(action, exe, addr, data string) {
	unitPath := "/etc/systemd/system/" + serviceName + ".service"
	unit := systemdUnit(exe, addr, data)

	switch action {
	case "print":
		fmt.Print(unit)
		return
	case "install":
		if err := os.WriteFile(unitPath, []byte(unit), 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "write %s: %v (are you root?)\n", unitPath, err)
			os.Exit(1)
		}
		mustRun("systemctl", "daemon-reload")
		mustRun("systemctl", "enable", "--now", serviceName)
		fmt.Printf("installed and started %s.service\n", serviceName)
		fmt.Printf("  status:  systemctl status %s\n", serviceName)
		fmt.Printf("  logs:    journalctl -u %s -f\n", serviceName)
	case "uninstall":
		_ = exec.Command("systemctl", "disable", "--now", serviceName).Run()
		if err := os.Remove(unitPath); err != nil && !os.IsNotExist(err) {
			fmt.Fprintf(os.Stderr, "remove %s: %v\n", unitPath, err)
		}
		_ = exec.Command("systemctl", "daemon-reload").Run()
		fmt.Printf("removed %s.service\n", serviceName)
	case "status":
		_ = exec.Command("systemctl", "status", serviceName).Run()
		// systemctl already prints to stdout
	default:
		fmt.Fprintf(os.Stderr, "unknown service action %q (use install|uninstall|status|print)\n", action)
		os.Exit(1)
	}
}

// ---------------------------------------------------------------- launchd ---

func launchdPlist(exe, addr, data string) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>io.%s</string>
  <key>ProgramArguments</key>
  <array>
    <string>%s</string>
    <string>-addr</string><string>%s</string>
    <string>-data</string><string>%s</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/%s.log</string>
  <key>StandardErrorPath</key><string>/tmp/%s.err.log</string>
</dict>
</plist>
`, serviceName, exe, addr, data, serviceName, serviceName)
}

func launchdService(action, exe, addr, data string) {
	home, _ := os.UserHomeDir()
	plistPath := filepath.Join(home, "Library", "LaunchAgents", "io."+serviceName+".plist")
	plist := launchdPlist(exe, addr, data)

	switch action {
	case "print":
		fmt.Print(plist)
		return
	case "install":
		_ = os.MkdirAll(filepath.Dir(plistPath), 0o755)
		if err := os.WriteFile(plistPath, []byte(plist), 0o644); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		_ = exec.Command("launchctl", "unload", plistPath).Run()
		mustRun("launchctl", "load", "-w", plistPath)
		fmt.Printf("installed and started io.%s (launch agent)\n", serviceName)
	case "uninstall":
		_ = exec.Command("launchctl", "unload", "-w", plistPath).Run()
		_ = os.Remove(plistPath)
		fmt.Printf("removed io.%s\n", serviceName)
	case "status":
		_ = exec.Command("launchctl", "list", "io."+serviceName).Run()
	default:
		fmt.Fprintf(os.Stderr, "unknown service action %q\n", action)
		os.Exit(1)
	}
}

// ---------------------------------------------------------------- windows ---

func windowsService(action, exe, addr, data string) {
	binPath := fmt.Sprintf(`"%s" -addr %s -data %s`, exe, addr, data)
	switch action {
	case "print":
		fmt.Printf("sc.exe create %s binPath= %q start= auto\n", serviceName, binPath)
		return
	case "install":
		mustRun("sc.exe", "create", serviceName, "binPath=", binPath, "start=", "auto")
		mustRun("sc.exe", "start", serviceName)
		fmt.Printf("installed and started %s service\n", serviceName)
	case "uninstall":
		_ = exec.Command("sc.exe", "stop", serviceName).Run()
		_ = exec.Command("sc.exe", "delete", serviceName).Run()
		fmt.Printf("removed %s service\n", serviceName)
	case "status":
		_ = exec.Command("sc.exe", "query", serviceName).Run()
	default:
		fmt.Fprintf(os.Stderr, "unknown service action %q\n", action)
		os.Exit(1)
	}
}

func mustRun(name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "%s %s: %v\n", name, strings.Join(args, " "), err)
	}
}
