# Investigation: Freeze / Crash When Switching from Legacy Extension

**Issue:** [#6721](https://github.com/Kilo-Org/kilocode/issues/6721)
**Symptom:** Long freeze (a few minutes), high CPU, when first launching the new extension after using the old Kilo Code v5.x extension.

---

## Most Probable Root Cause: macOS Security Scanning of the CLI Binary

The new extension works fundamentally differently from the old one: it bundles and spawns a **118 MB native binary** (`bin/kilo`, a Bun standalone executable) as a child process. The old extension ran entirely inside VS Code's extension host.

On macOS, the first execution of a new binary triggers security checks by the OS:

- **Gatekeeper** verifies the code signature
- **XProtect** (Apple's built-in malware scanner) scans the binary
- **Notarization** staple verification (if not stapled, an online check may occur)

The binary is currently **ad-hoc signed** (`Signature=adhoc`, `TeamIdentifier=not set`), not signed with an Apple Developer certificate:

```
$ codesign -dv bin/kilo
CodeDirectory v=20400 flags=0x20002(adhoc,linker-signed)
Signature=adhoc
TeamIdentifier=not set
```

For an unsigned or ad-hoc signed 118 MB binary, macOS security subsystems perform an **extended scan of the entire file**. This is CPU-intensive and can take **1–5 minutes** on a cold system, which matches the reported symptom exactly. After the first run, macOS caches the scan result and subsequent launches are fast.

This explains all the observed characteristics:

- **High CPU** (XProtect/Gatekeeper doing cryptographic work across 118 MB)
- **"A few minutes"** duration (proportional to binary size)
- **Only happens once** (the first time the binary runs after install/upgrade)
- **Specific to switching** (new users of the CLI-backed extension encounter this binary for the first time; users already using the `kilo` TUI would have already triggered this scan)

### Evidence

```
$ codesign --verify bin/kilo
bin/kilo: invalid signature (code or signature have been modified)
In architecture: arm64

$ ls -la bin/kilo
-rwxr-xr-x  1 mark  staff  118167824  bin/kilo  # 118 MB
```

---

## Secondary Issue: 30-Second Startup Timeout

The `ServerManager` waits for the CLI to print its port to stdout, with a hard 30-second timeout (`server-manager.ts:122-128`). The port is only printed after the yargs middleware completes, which includes:

- `Config.getGlobal()` — reads config files
- `Telemetry.init()` — initializes PostHog/OTel
- `migrateLegacyKiloAuth()` — reads `~/.kilocode/cli/config.json`
- JSON→SQLite migration check (fast for new users, potentially slow for CLI veterans with many sessions)

If macOS security scanning delays the binary's first output to stdout by more than 30 seconds, the extension kills the process and shows a "Server startup timeout" error, which manifests as a crash.

However, testing shows the binary starts and emits its port in ~0.7s when security scans are already cached, so this only compounds the Gatekeeper issue.

---

## Ruled Out

| Hypothesis                             | Why Ruled Out                                                        |
| -------------------------------------- | -------------------------------------------------------------------- |
| Migration wizard blocking startup      | Runs after CLI connects; only reads small secrets/files              |
| Large `taskHistory` in globalState     | Contains only metadata (no message content); parsing is fast         |
| JSON→SQLite one-time migration         | Returns immediately when storage dir doesn't exist (new CLI users)   |
| Running both extensions simultaneously | Same publisher+name prevents co-installation; VS Code won't allow it |
| Model list fetch from `api.kilo.ai`    | 10-second timeout; doesn't cause minutes-long freeze                 |
| Extension host memory pressure         | Both extensions can't be active at once (same ID)                    |

---

## Recommended Fixes

### 1. Properly sign and notarize the binary (highest impact)

Sign the CLI binary with an Apple Developer certificate and notarize it before bundling it into the VSIX. This eliminates the macOS security scan on first execution and also removes the Gatekeeper dialog that otherwise blocks users.

### 2. Show a progress notification during CLI startup

Display a VS Code progress notification while waiting for the CLI to start. This prevents VS Code from appearing frozen even if startup takes longer than expected:

```ts
await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Kilo: Starting..." }, () =>
  this.connectionService.connect(),
)
```

### 3. Increase the startup timeout

The 30-second hard limit (`server-manager.ts:122`) is too tight for first-run scenarios. Increasing it to 3–5 minutes prevents false "Server startup timeout" crashes while macOS scans the binary.

### 4. Detect and surface the first-run delay

The extension could check whether the binary has been run before (e.g. by testing if a sentinel file exists in the CLI's data dir) and show a "First run: initializing…" message to set user expectations.
