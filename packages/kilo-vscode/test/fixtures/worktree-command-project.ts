import assert from "node:assert/strict"
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createRoot, createSignal } from "solid-js"
import { createAppSession } from "../../webview-ui/agent-manager/app-session"
import { createDialogCommandMenu } from "../../webview-ui/agent-manager/dialog-commands"
import { panelRelay } from "./panel-relay"

// The panel's event connection uses page lifecycle events in the webview.
Object.assign(globalThis, {
  window: new EventTarget(),
  document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
})

const repo = path.resolve(import.meta.dir, "../../../..")
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "am-command-project-")))
try {
  const alpha = await project("alpha")
  const bravo = await project("bravo")
  const server = Bun.spawn([process.execPath, "dev", "serve", "--stdio", "--port", "0"], {
    cwd: repo,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      HOME: root,
      USERPROFILE: root,
      KILO_V2_PROFILE: path.join(root, "profile"),
      OPENCODE_PASSWORD: "fixture",
      KILO_DISABLE_MODELS_FETCH: "1",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: path.join(root, "empty-gitconfig"),
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  })
  const timeout = setTimeout(() => server.stdin.end(), 60_000)
  try {
    const lines = server.stdout.pipeThrough(new TextDecoderStream()).getReader()
    let output = ""
    while (!output.includes("\n")) {
      const chunk = await lines.read()
      assert(!chunk.done, "Server did not report its listening URL")
      output += chunk.value
    }
    const { url } = JSON.parse(output.split("\n")[0]!) as { url: string }
    await verify(url, alpha, bravo)
  } finally {
    clearTimeout(timeout)
    server.stdin.end()
    await server.exited
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
process.exit(0)

async function project(name: string) {
  const directory = path.join(root, name)
  await mkdir(path.join(directory, ".kilo2", "command"), { recursive: true })
  await Bun.write(path.join(directory, ".kilo2", "command", `audit-${name}-only.md`), `Audit ${name}.\n`)
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", "-C", directory, ...args], {
      env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1" },
    })
    assert.equal(result.exitCode, 0, result.stderr.toString())
  }
  git("init", "-b", "main", "--template=")
  git("add", ".kilo2")
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", name)
  return directory
}

async function verify(url: string, alpha: string, bravo: string) {
  const [commandProject, setCommandProject] = createSignal<string>()
  let alphaReply = false
  const releaseAlpha = Promise.withResolvers<void>()
  const relay = panelRelay({ url, authorization: `Basic ${btoa("opencode:fixture")}` }, async (request) => {
    const response = await fetch(request)
    const target = new URL(request.url)
    if (target.pathname === "/api/command" && target.searchParams.get("location[directory]") === alpha) {
      // Delay delivery of Alpha's actual server response, not the server or its catalog.
      alphaReply = true
      await releaseAlpha.promise
    }
    return response
  })
  const panel = createRoot((dispose) => {
    const options = {
      rootDirectory: () => bravo,
      commandProject,
      directories: {
        root: (id: string | undefined) => (id === "alpha" ? alpha : id === "bravo" ? bravo : undefined),
        visibleDirectories: () => [bravo],
        retained: () => [bravo, alpha],
        sessionDirectories: () => [bravo],
        missingDirectories: () => [],
        directoryOf: () => bravo,
        worktreePath: () => undefined,
        worktreePathIn: () => undefined,
      },
      vscode: relay.vscode,
    }
    const app = createAppSession(options)
    const menu = createDialogCommandMenu({ commands: app.commands, hidden: () => new Set() })
    menu.onInput("/audit-", 7)
    return { app, dispose, names: () => menu.results().map((command) => command.name) }
  })
  try {
    setCommandProject("bravo")
    await until(
      () => panel.names().includes("audit-bravo-only"),
      () => panel.names(),
    )

    setCommandProject("alpha")
    assert.deepEqual(panel.names(), [], "Alpha must not show Bravo's commands while loading")
    await until(
      () => alphaReply,
      () => panel.names(),
    )

    setCommandProject("bravo")
    releaseAlpha.resolve()
    await until(
      () =>
        panel.app.panel
          .find(alpha)
          ?.data.location.command.list()
          ?.some((command) => command.name === "audit-alpha-only") === true,
      () => panel.names(),
    )
    assert.deepEqual(panel.names(), ["audit-bravo-only"], "A late Alpha response must not replace Bravo's catalog")

    setCommandProject("alpha")
    assert.deepEqual(panel.names(), ["audit-alpha-only"])
  } finally {
    releaseAlpha.resolve()
    panel.dispose()
    relay.dispose()
  }
}

async function until(check: () => boolean, names: () => string[]) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (check()) return
    await Bun.sleep(20)
  }
  assert.fail(`Command catalog did not reach the expected state: ${names().join(", ")}`)
}
