// Build the portable artifact into a fresh owned temp dir, MOVE it to a relocated path (the
// original build path no longer exists), then run the two bundled smoke entries as relocated
// children, sequentially and each in its OWN isolated home:
//   1. Auto smoke (portable-smoke-entry.js): real launch() host + loopback Gateway Auto flow
//      (both native routes, routedModelID readback, metadata hygiene). Asserts the two routed
//      native modules resolve inside the relocated root. Marker: KILO_PORTABLE_SMOKE_OK.
//   2. TUI smoke (portable-tui-smoke-entry.js): headless createTestRenderer mounts the real
//      shipped TUI with a loopback model server; proves the mounted client.connection stays
//      "connected" past the reconnect grace (no "Connection lost" overlay), the SHIPPED
//      kilo.preview plugin renders its own slots (Kilo logo ASCII + the
//      "Kilo internal preview · isolated interactive store · Connect Kilo to sign in" footer) at
//      narrow and wide widths, a loopback prompt/reply round-trip renders through the mounted
//      connection, and /exit cleanly destroys the renderer. Marker: KILO_PORTABLE_TUI_SMOKE_OK.
// One build, one move, both children. Bounded temp-only; graceful child cleanup; try/finally
// removal of the owned temp root. No install, network, or credentials.
import { lstat, mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { requireRuntime } from "../src/runtime"

requireRuntime()
if (process.platform === "win32") throw new Error("The portable smoke currently targets macOS/Linux")

const cliRoot = path.resolve(import.meta.dir, "..")
const work = await mkdtemp(path.join(os.tmpdir(), "kilo-portable-smoke-"))
const buildDir = path.join(work, "build")
const relocated = path.join(work, "relocated")
const tmp = path.join(work, "tmp")

// Run one bundled smoke entry from the relocated artifact in a scrubbed, isolated env with its
// own HOME/XDG stores and project dir; assert exit 0 and that its marker appears on stdout.
// extraEnv lets a child receive artifact-specific values (e.g. the artifact root for the PTY
// binary-containment assertion).
async function runChild(
  entry: string,
  marker: string,
  homeName: string,
  extraEnv: Record<string, string> = {},
): Promise<string> {
  const home = path.join(work, homeName)
  const project = path.join(work, `${homeName}-project`)
  await mkdir(home, { recursive: true })
  await mkdir(project, { recursive: true })
  // The per-child opencode-pty daemon runtime dir must exist AND be mode 0700: the daemon's
  // privateDirectory() check requires owner-only perms, and the host's launch() hangs silently
  // (no stdout, no URL) if $XDG_RUNTIME_DIR is too permissive.
  await mkdir(path.join(home, "run"), { recursive: true, mode: 0o700 })
  const child = Bun.spawn([path.join(relocated, "bun"), "--no-env-file", path.join(relocated, "script", entry)], {
    cwd: project,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: {
      PATH: "/usr/bin:/bin",
      HOME: home,
      USERPROFILE: home,
      TMPDIR: tmp,
      TMP: tmp,
      TEMP: tmp,
      ...extraEnv,
      XDG_DATA_HOME: path.join(home, "data"),
      XDG_CONFIG_HOME: path.join(home, "config"),
      XDG_CACHE_HOME: path.join(home, "cache"),
      XDG_STATE_HOME: path.join(home, "state"),
      // Isolate the per-child opencode-pty daemon runtime dir: without it every child shares the
      // host's XDG_RUNTIME_DIR, so one child's (detached) daemon can hold the registration and
      // block a later child's host boot. Each child gets its own so daemon lifecycles stay disjoint.
      XDG_RUNTIME_DIR: path.join(home, "run"),
      TERM: "dumb",
    },
    timeout: 130000,
    killSignal: "SIGTERM",
  })
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (code !== 0 || !stdout.includes(marker)) {
      throw new Error(`${entry} failed (exit ${code})\nstdout:\n${stdout}\nstderr:\n${stderr}`)
    }
    return stdout
  } finally {
    child.kill("SIGTERM")
    await child.exited
  }
}

async function main() {
  await mkdir(tmp, { recursive: true })
  // 1) Build into the owned build dir (the builder creates it exclusively and never deletes).
  const build = Bun.spawn(
    [process.execPath, "--no-env-file", path.join(cliRoot, "script/build-portable.ts"), buildDir],
    { cwd: cliRoot, stdout: "inherit", stderr: "inherit", env: { PATH: process.env.PATH, HOME: process.env.HOME } },
  )
  if ((await build.exited) !== 0) throw new Error("Portable build failed")

  // 2) MOVE the artifact to the relocated path: only the relocated tree exists afterward.
  await rename(buildDir, relocated)
  const buildGone = await lstat(buildDir).then(
    () => false,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return true
      throw error
    },
  )
  if (!buildGone) throw new Error(`Relocation failed: original build path still exists: ${buildDir}`)

  // 3) Auto smoke: real host + loopback Gateway Auto flow; routed modules must resolve inside
  //    the relocated root (canonicalized for macOS /var -> /private/var).
  const autoOut = await runChild("portable-smoke-entry.js", "KILO_PORTABLE_SMOKE_OK", "home-auto")
  const match = autoOut.match(/KILO_PORTABLE_SMOKE_OK (\{.*\})/)
  const payload = match ? (JSON.parse(match[1]) as { routes?: Record<string, string> }) : {}
  const relocatedReal = await realpath(relocated)
  for (const [routeName, url] of Object.entries(payload.routes ?? {})) {
    const filePath = url.startsWith("file://") ? new URL(url).pathname : url
    const resolved = await realpath(filePath).catch(() => filePath)
    if (!resolved.startsWith(relocatedReal + path.sep)) {
      throw new Error(`Routed module ${routeName} resolved outside the relocated artifact: ${url}`)
    }
  }
  console.log(autoOut.trim())

  // 4) TUI smoke: the shipped kilo.preview plugin renders its own slots (logo + footer) at
  //    narrow and wide widths, then a clean exit. Separate isolated home from the Auto run.
  const tuiOut = await runChild("portable-tui-smoke-entry.js", "KILO_PORTABLE_TUI_SMOKE_OK", "home-tui")
  console.log(tuiOut.trim())

  // 5) PTY smoke: the artifact-contained opencode-pty native binary resolves inside the
  //    relocated root, a real native PTY spawns via the public persistentPty API, the command
  //    output streams through the terminal websocket attach, and shutdown is clean. Pass the
  //    artifact root so the entry can assert the binary stays inside it.
  const ptyOut = await runChild("portable-pty-smoke-entry.js", "KILO_PORTABLE_PTY_SMOKE_OK", "home-pty", {
    KILO_PORTABLE_ARTIFACT_ROOT: relocated,
  })
  console.log(ptyOut.trim())

  // 6) Real-launcher smoke: the actual kilo2 LAUNCHER BINARY boots the host via `kilo2 serve`
  //    (not in-process launch), reports its loopback URL + password file, answers the public
  //    /api/health readiness API, then stops gracefully on SIGTERM with no orphan launcher.
  const launcherOut = await runChild(
    "portable-launcher-smoke-entry.js",
    "KILO_PORTABLE_LAUNCHER_SMOKE_OK",
    "home-launcher",
    {
      KILO_PORTABLE_ARTIFACT_ROOT: relocated,
    },
  )
  console.log(launcherOut.trim())

  // 7) Session-terminal PTY smoke (@lydell/node-pty, the public `pty` API — DISTINCT from the
  //    persistent-pty daemon): create an interactive shell PTY, drive it through the public
  //    terminal websocket attach (echo marker + stty size after a resize), remove it, and prove
  //    the child pid is actually dead (incl. an induced-failure cleanup pass).
  const sessionPtyOut = await runChild(
    "portable-pty-session-smoke-entry.js",
    "KILO_PORTABLE_PTY_SESSION_SMOKE_OK",
    "home-pty-session",
  )
  console.log(sessionPtyOut.trim())

  console.log("KILO_PORTABLE_SMOKE_RUNNER_OK")
}

try {
  await main()
} finally {
  await rm(work, { recursive: true, force: true })
}
