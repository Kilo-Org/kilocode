---
name: jetbrains-sandbox
description: Install and operate IntelliJ in a Linux cloud sandbox. Provide a browser desktop and MCP Steroid so an agent can inspect, edit, debug, configure, or automate the IDE using whichever interface suits the task. Kilo installation and screenshot helpers are optional conveniences.
---

# JetBrains Sandbox

Use this skill to give an agent a running IntelliJ instance and the means to control it.
The setup provides IntelliJ IDEA, MCP Steroid, and a minimal browser desktop using
TigerVNC, Openbox, and noVNC. It is not tied to testing a particular plugin or following
a prescribed IDE workflow. The HTTP transport works through sandbox HTTPS proxies that
break WebSocket upgrades.

## Boundaries

- Tested on Debian 13, Linux x86-64, with Bun available. Allow roughly 8 GB RAM and
  10 GB free disk for the IDE, archives, plugins, and caches.
- Installation needs root for apt and creating the IDE account. With dependencies
  preinstalled, a non-root account can use `--skip-deps` and run as itself.
- **No public tunnel or viewer password is created.** The default bind is loopback.
  Use `--host 0.0.0.0` only behind the user's authenticated sandbox port forwarding.
  Binding only to `127.0.0.1` may make the platform report that nothing is listening.
- Raw VNC and MCP remain bound to loopback even when the viewer is externally reachable.
- If a secure preview proxy rewrites `Host`, pass its exact browser-facing origin with
  `--origin https://your-preview-host`. Arbitrary forwarded headers are not trusted.
- Do not accept JetBrains agreements, start a trial, sign into services, copy the agent's
  credentials into the IDE, or dismiss unrelated dialogs automatically.
- All runtime state defaults to the current worktree's ignored
  `.kilo-dev/jetbrains-sandbox/`. Never point `--dir` at the workspace itself.
- Never overwrite plugin jars while that state directory's IDE is running. Stop first.
- Do not stop another session's IDE or alter the user's workspace ownership. A supplied
  `--project` must already be accessible to the selected non-root `--user`.

## Pinned Setup

| Component | Default |
|---|---|
| IntelliJ IDEA | 2026.1, including its bundled Java runtime |
| MCP Steroid | 0.102.0-r-c68d8f15d |
| Optional Kilo plugin | Signed 7.1.12 release, only with `--with-kilo` |

Downloads are SHA-256 checked against the tested artifacts. Versions and hashes live
together in `script/setup.ts`; update them intentionally rather than silently fetching
latest. A trusted local ZIP override is not checked against the release digest.

The default installs no Kilo plugin and builds no repository code. It opens an empty
workspace unless `--project` is supplied, without adding sample files to it.

For Kilo-specific work, opt in with `--with-kilo`, or pass
`--kilo-zip /absolute/path/to/plugin.zip` to install a local build. Building that ZIP is
a separate workflow, such as `jetbrains-dev`; it may need Java 21 and Maven access.
Do not silently substitute a released plugin for the user's local changes.

## Install And Run

Run from the current worktree root:

```bash
bun .kilo/skills/jetbrains-sandbox/script/setup.ts install --host 0.0.0.0
```

Use a bounded `background_process.monitor` for a cold install. Downloads and extraction
can outlast one tool call; follow the returned process rather than starting another install.

Then start the foreground supervisor with `background_process.start`:

```bash
bun .kilo/skills/jetbrains-sandbox/script/setup.ts run
```

Use readiness pattern `Desktop ready` or port `6080`. Do not use shell `&`, `nohup`, or
an untracked daemon. The supervisor runs VNC, Openbox, and IntelliJ as the non-root IDE
user, strips inherited agent credentials, and stops its supervised processes on termination.
It stops the desktop if an essential child exits; it does not silently restart the IDE.
JetBrains can retain a per-user helper daemon after the IDE closes. Do not kill shared
user daemons indiscriminately or affect another IDE session.

Open http://localhost:6080/ through the sandbox's secure forwarding. The user must finish
any first-run agreements and authentication required by their task. A listener alone
does not prove that the IDE or MCP is ready; inspect the UI and use `status`.
The viewer scales a fixed 1600x1000 desktop rather than shrinking the remote screen,
so first-run dialog buttons remain reachable in small browser windows. Use Fullscreen
for more readable text.

```bash
bun .kilo/skills/jetbrains-sandbox/script/setup.ts status
bun .kilo/skills/jetbrains-sandbox/script/setup.ts stop
```

Prefer quitting IntelliJ normally for graceful application shutdown. `stop` verifies the
supervisor's PID/start identity before signaling it. The tracked process can also be
stopped with `background_process.stop`. Restart with `run`, not a second simultaneous IDE.

Useful install options:

```bash
bun .kilo/skills/jetbrains-sandbox/script/setup.ts install \
  --dir /tmp/my-ide \
  --ide /existing/idea-2026.1 \
  --project /path/to/writable/project \
  --host 0.0.0.0 --display 100 --port 6090 --vnc-port 5998 --mcp-port 6316 \
  --skip-deps
```

Repeat `--dir /tmp/my-ide` for later commands; saved paths and viewer/MCP ports are reused.
`--ca /path/to/sandbox-ca.crt` defaults to `NODE_EXTRA_CA_CERTS`. The installer copies the
bundled Java trust store into isolated state, adds the public CA to that copy, and makes
the CA available to the CLI. It does not disable TLS checks or alter a reused IDE's files.

## Choose A Control Method

Choose the interface appropriate to the user's task; these helpers do not constrain
what the agent can do in IntelliJ:

- **MCP and IntelliJ APIs:** discover tools and use arbitrary Kotlin execution for
  editor navigation, PSI inspection, refactoring, project setup, debugging, settings,
  actions, or tool-window interaction. The agent may use its own MCP client directly.
- **Desktop interaction:** use the viewer, browser automation, or native desktop input
  when the task calls for real clicks, typing, menus, or visual checks.
- **Other IDE interfaces:** use IntelliJ's command-line launcher or built-in REST server
  where appropriate. The skill does not require every action to go through MCP.

The `mcp`, `screenshot`, and `serve` commands are conveniences, not a fixed testing flow.
No agent MCP configuration is modified automatically.

## MCP Control

MCP Steroid listens at http://127.0.0.1:6315/mcp by default. These commands initialize
the MCP session, call the real tool, and close the session:

```bash
bun .kilo/skills/jetbrains-sandbox/script/setup.ts mcp steroid_list_projects
bun .kilo/skills/jetbrains-sandbox/script/setup.ts mcp steroid_list_windows
bun .kilo/skills/jetbrains-sandbox/script/setup.ts mcp tools/list
bun .kilo/skills/jetbrains-sandbox/script/setup.ts mcp steroid_execute_code '{"project_name":"<routing-key>","task_id":"ide-test","reason":"Inspect the selected project","code":"println(project.name)"}'
```

Use the opaque `project_name` from project discovery, not the folder name. API calls
can be more reliable than simulated shortcuts; the shortcut probe in the tested sandbox
was unreliable. For GUI tasks, inspect the focused control before typing. Read-only PSI
access needs a read action; UI operations need EDT. Only modify source intentionally.

To open modal Settings, use `modal: "unleashed"` and schedule
`ShowSettingsUtil.getInstance().showSettingsDialog(project, "Appearance")` with
`ApplicationManager.getApplication().invokeLater`. The normal execution mode may close
modal dialogs. Do not pass a nullable String to that overload; it does not compile.

## Screenshots

```bash
bun .kilo/skills/jetbrains-sandbox/script/setup.ts screenshot --settings
```

This reuses an existing Settings dialog or opens Appearance without changing any setting,
then captures that dialog through MCP. It refuses to dismiss unrelated modal dialogs.
Without `--settings`, it captures the chosen project's IDE window. Use `--project` when
multiple projects are open. Settings window detection currently uses English titles.

Serve only the resulting PNG with another tracked foreground process:

```bash
bun .kilo/skills/jetbrains-sandbox/script/setup.ts serve --host 0.0.0.0
```

Open http://localhost:6083/. This is a static screenshot, not the live desktop. `--out`
selects another PNG for capture or serving; `serve --port` selects a separate port.
No runtime directory listing, MCP endpoint, logs, or other files are exposed by this server.

## Verify

The installer has no unit-test file. Smoke-test a clean state directory with separate
ports: install, start, inspect the first-run UI, stop/restart, and reinstall unchanged
artifacts. Do not accept agreements just to complete a smoke test.

```bash
# From .kilo/skills/jetbrains-sandbox/script, not the repository root:
bun test ./desktop.test.ts ./mcp.test.ts
```

Before handing off a running sandbox, verify the container's non-loopback viewer address
responds, the browser renders real IDE pixels, MCP reports the intended project, and any
served image is a PNG. Leave unrelated IDEs and tracked source files unchanged. Be explicit
about first-run dialogs, source-build/network restrictions, and untested login or model flows.
