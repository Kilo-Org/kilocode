import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { run as runTui, type TuiInput } from "@opencode-ai/tui"
import { Global } from "@opencode-ai/util/global"
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing"
import { Cause, Effect, Exit } from "effect"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"
import { createTuiConfig } from "../src/tui-config"

const scenario = process.env.TUI_PROCESSES_SCENARIO
assert(scenario === "lifecycle" || scenario === "resume" || scenario === "server" || scenario === "client")

const setups: TestRendererSetup[] = []
const setup = await createTestRenderer({ width: 160, height: 40, useThread: false })
setup.renderer.start()
setups.push(setup)

const root = await mkdtemp(path.join(os.tmpdir(), "kilo-processes-fixture-"))
const repo = path.join(root, "repo")
const repo2 = path.join(root, "repo2")
const plugins = path.join(root, "plugins", "process-fixture")
await Promise.all([repo, repo2, plugins].map((directory) => mkdir(directory, { recursive: true })))

const gitBinary = Bun.which("git")
assert(gitBinary, "fixture requires git on PATH")
const git = (args: string[], cwd: string) => {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: process.env, stdout: "pipe", stderr: "pipe" })
  assert.equal(result.exitCode, 0, `git ${args.join(" ")} failed: ${result.stderr.toString()}`)
}
for (const directory of [repo, repo2]) {
  git(["init", "-b", "main"], directory)
  git(["config", "user.email", "fixture@example.com"], directory)
  git(["config", "user.name", "Fixture"], directory)
  git(["commit", "--allow-empty", "-m", "one"], directory)
}

const input = layout("interactive")
const location = { directory: repo }
type Endpoint = Effect.Success<ReturnType<typeof launch>>

const connect = (endpoint: Endpoint) =>
  createClient({
    baseUrl: endpoint.url,
    headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
  })

// Each host runs in its own scope, so a restart scenario can release the
// interactive store lock before the next launch on the same layout.
const startHost = () => {
  const started = Promise.withResolvers<Endpoint>()
  const stop = Promise.withResolvers<void>()
  const done = Effect.runPromise(
    Effect.exit(
      Effect.scoped(
        Effect.gen(function* () {
          const endpoint = yield* launch(input, { models: false, recover: false })
          yield* Effect.sync(() => started.resolve(endpoint))
          yield* Effect.promise(() => stop.promise)
        }),
      ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
    ),
  ).then((exit) => {
    if (Exit.isSuccess(exit)) return
    // Stopping a host whose shell is still running interrupts the in-flight
    // shell awaiter during teardown; that interrupt-only exit is the expected
    // close, while real failures and defects still surface. The store lock is
    // released by the finalizers before the promise settles either way.
    if (Cause.hasInterruptsOnly(exit.cause)) return
    throw Cause.squash(exit.cause)
  })
  done.catch((error) => started.reject(error))
  return { endpoint: started.promise, stop, done }
}

// Each boot hands off a fresh test renderer: the TUI destroys the renderer on
// exit, so a reopened client cannot reuse the previous one.
const bootTui = (testSetup: TestRendererSetup, endpoint: Endpoint, sessionID: string) => {
  const ready = Promise.withResolvers<void>()
  const closed = Promise.withResolvers<void>()
  const config = createTuiConfig(input, {
    plugins: [],
    session: { terminal: false },
    attention: { enabled: false },
    terminal: { title: false },
  })
  const tuiInput: TuiInput = {
    app: { name: "kilo2", version: "0.0.0-fixture", channel: input.channel },
    server: { endpoint },
    args: { sessionID },
    config,
    packages: {
      prepare: async () => {
        throw new Error("No package plugins are expected in the processes fixture")
      },
    },
    pluginDirectories: [path.dirname(plugins)],
    terminalHandoff: async () => ({ renderer: testSetup.renderer, mode: "dark" as const, complete: ready.resolve }),
  }
  const done = Effect.runPromise(
    runTui(tuiInput).pipe(
      Effect.provide(Global.layerWith(input.paths)),
      Effect.ensuring(Effect.sync(closed.resolve)),
      Effect.provide(NodeHttpServer.layerHttpServices),
    ),
  )
  return { ready: ready.promise, closed: closed.promise, done }
}

// Slash commands race the prompt's reset after the previous submit, so
// dispatch is retried until its effect is visible.
const dispatch = async (testSetup: TestRendererSetup, name: string, predicate: (frame: string) => boolean) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    await Bun.sleep(500)
    await testSetup.mockInput.typeText(name)
    testSetup.mockInput.pressEnter()
    const ok = await testSetup.waitForFrame(predicate, { maxPasses: 60 }).then(
      () => true,
      () => false,
    )
    if (ok) return
  }
  assert.fail(`slash command never took effect: ${name}`)
}

const productionModule = path.resolve(import.meta.dir, "../src/tui-plugin/sidebar-processes.tsx")
const writePluginFiles = (sessionID: string, secondID: string) => {
  writeFileSync(
    path.join(plugins, "package.json"),
    JSON.stringify(
      {
        name: "kilo.process-fixture",
        version: "0.0.0-internal",
        private: true,
        type: "module",
        exports: { "./tui": "./tui.tsx" },
      },
      null,
      2,
    ),
  )
  const fixturePlugin = [
    `import { installProcessSidebar } from ${JSON.stringify(productionModule)}`,
    "",
    "export default {",
    '  id: "kilo.process-fixture",',
    "  setup(ctx) {",
    "    installProcessSidebar(ctx, {})",
    "    ctx.ui.slot({",
    '      append: "app",',
    "      render: () => {",
    "        ctx.keymap.layer(() => ({",
    '          mode: "global",',
    "          commands: [",
    "            {",
    '              id: "kilo.process-fixture.resync",',
    '              title: "Resync fixture messages",',
    '              slash: { name: "fixture-resync" },',
    "              run: async () => {",
    "                const route = ctx.ui.router.current()",
    '                if (route.type !== "session") return',
    "                ctx.data.session.message.invalidate(route.sessionID)",
    "                await ctx.data.session.message.sync(route.sessionID)",
    "              },",
    "            },",
    "            {",
    '              id: "kilo.process-fixture.second",',
    '              title: "Open second fixture tab",',
    '              slash: { name: "fixture-second" },',
    "              run: async () => {",
    `                ctx.ui.tabs.open(${JSON.stringify(secondID)})`,
    "              },",
    "            },",
    "            {",
    '              id: "kilo.process-fixture.first",',
    '              title: "Open first fixture tab",',
    '              slash: { name: "fixture-first" },',
    "              run: async () => {",
    `                ctx.ui.tabs.open(${JSON.stringify(sessionID)})`,
    "              },",
    "            },",
    "          ],",
    "        }))",
    "        return null",
    "      },",
    "    })",
    "  },",
    "}",
    "",
  ].join("\n")
  writeFileSync(path.join(plugins, "tui.tsx"), fixturePlugin)
}

const handoff = (boot: { ready: Promise<void>; closed: Promise<void> }) =>
  Promise.race([
    boot.ready,
    boot.closed.then(() => {
      throw new Error("TUI closed before terminal handoff")
    }),
  ])

const stage = (message: string) => process.stderr.write(`TUI processes fixture: ${message}\n`)

const task = (async () => {
  const host = startHost()
  const endpoint = await host.endpoint
  stage("first host listening")
  const client = connect(endpoint)
  const session = await client.session.create({ title: "Process sidebar fixture", location })
  const second = await client.session.create({ title: "Process sidebar second", location: { directory: repo2 } })
  await client.plugin.awaitActivation({ location })
  writePluginFiles(session.id, second.id)
  stage("sessions and plugin ready")

  const boot = bootTui(setup, endpoint, session.id)
  boot.done.catch((error) => stage(`boot1 failed: ${error}`))
  await handoff(boot)
  await setup.waitForFrame((frame) => frame.includes("Process sidebar fixture"), { maxPasses: 600 })
  stage("first client rendered")

  // A real background session shell through the public session.shell API:
  // the producer records the durable shell part and the live ShellInfo.
  const command = scenario === "lifecycle" ? "sleep 30" : scenario === "resume" ? "sleep 3" : "sleep 60"
  void client.session.shell({ sessionID: session.id, command }).catch(() => undefined)

  if (scenario === "lifecycle") {
    await setup.waitForFrame((frame) => frame.includes("sleep 30"), { maxPasses: 600 })
    // The created event's record carries no PID; the section refreshes the
    // store once and the real PID row appears right after.
    await setup.waitForFrame((frame) => /PID \d+/.test(frame), { maxPasses: 600 })
    const frameLines = setup.captureCharFrame().split("\n")
    // The composer also echoes the running command, so the sidebar row is
    // the LAST occurrence in the frame.
    const row = frameLines.findLast((entry) => entry.includes("sleep 30"))
    assert(row, "running shell row rendered")
    const following = setup.captureCharFrame().split("\n")
    const pidRow = following[following.indexOf(row) + 1]
    assert(pidRow && /PID \d+/.test(pidRow), `real PID row must follow the command row, got: ${pidRow}`)
    // Resumed-session truth: re-fetching the durable history keeps the
    // running row (membership is history-derived, not event-seeded).
    await dispatch(setup, "/fixture-resync", (frame) => /PID \d+/.test(frame) && frame.includes("sleep 30"))
    // Other sessions must not see this shell: the tab switch changes the
    // viewed session, so the row disappears from the sidebar.
    await dispatch(setup, "/fixture-second", (frame) => !/PID \d+/.test(frame))
    await dispatch(setup, "/fixture-first", (frame) => /PID \d+/.test(frame))
    // Terminate through the public shell API: a one-millisecond deadline
    // finishes the shell as "timeout" and kills the process. The shell
    // may also end naturally right here; either way the row must
    // disappear through the durable part and the live store.
    const shells = await client.shell.list({ location })
    const running = shells.data.find((shell) => shell.status === "running")
    assert(running, "running shell visible through the public list")
    await client.shell.timeout({ id: running.id, timeout: 1, location }).catch(() => undefined)
    await setup.waitForFrame((frame) => !/PID \d+/.test(frame), { maxPasses: 600 })
    await Bun.sleep(500)
    assert(!/PID \d+/.test(setup.captureCharFrame()), "terminated shell must not keep a PID row")
  }

  if (scenario === "resume") {
    await setup.waitForFrame((frame) => frame.includes("sleep 3"), { maxPasses: 600 })
    await dispatch(setup, "/fixture-resync", (frame) => /PID \d+/.test(frame) && frame.includes("sleep 3"))
    // The shell ends naturally while another session is focused, so the
    // location cache goes stale; revisiting the session must reconcile
    // it (invalidate + re-sync) instead of rendering a stale running row.
    await dispatch(setup, "/fixture-second", (frame) => !/PID \d+/.test(frame))
    for (let attempt = 0; attempt < 20; attempt++) {
      const shells = await client.shell.list({ location })
      if (!shells.data.some((shell) => shell.status === "running")) break
      await Bun.sleep(300)
    }
    const gone = !(await client.shell.list({ location })).data.some((shell) => shell.status === "running")
    assert(gone, "shell finished while the session was away")
    await dispatch(setup, "/fixture-first", (frame) => frame.includes("Process sidebar fixture"))
    await Bun.sleep(800)
    assert(!/PID \d+/.test(setup.captureCharFrame()), "revisited session must not render the ended shell")
    await dispatch(setup, "/fixture-resync", (frame) => !/PID \d+/.test(frame))
  }

  // The restart scenarios share the boot-1 premise: a live running row with a
  // real rendered PID, then the client quits while the durable part still
  // records the shell as running.
  if (scenario === "server" || scenario === "client") {
    await setup.waitForFrame((frame) => frame.includes(command) && /PID \d+/.test(frame), { maxPasses: 600 })
    stage("live running row rendered before restart")
    const rendered = setup.captureCharFrame().match(/PID (\d+)/)
    assert(rendered, "the running row renders a real PID")
    const pid = Number(rendered[1])
    const shells = await client.shell.list({ location })
    const running = shells.data.find((shell) => shell.status === "running")
    assert(running, "running shell visible through the public list")
    await setup.mockInput.typeText("/exit")
    setup.mockInput.pressEnter()
    await boot.closed
    await boot.done
    stage("first client exited")

    if (scenario === "client") {
      // Client-only reopen against the same host: the shell process is still
      // live in the untouched registry, so the reopened client renders the
      // row again with the same real PID.
      const reopened = await createTestRenderer({ width: 160, height: 40, useThread: false })
      reopened.renderer.start()
      setups.push(reopened)
      const reboot = bootTui(reopened, endpoint, session.id)
      await handoff(reboot)
      await reopened.waitForFrame((frame) => frame.includes("Process sidebar fixture"), { maxPasses: 600 })
      stage("reopened client rendered")
      const frame = await reopened.waitForFrame((frame) => frame.includes(`PID ${pid}`), { maxPasses: 600 })
      stage("live shell row rendered after reopen")
      const lines = frame.split("\n")
      const row = lines.findLast((entry) => entry.includes(command))
      assert(row, "the live shell row renders after the client-only reopen")
      const following = reopened.captureCharFrame().split("\n")
      const pidRow = following[following.indexOf(row) + 1]
      assert(
        pidRow && pidRow.includes(`PID ${pid}`),
        `the same real PID row must follow the command row, got: ${pidRow}`,
      )
      // The row is live truth, not a replayed cache: terminating the shell
      // through the public API removes it from the reopened client too.
      await client.shell.timeout({ id: running.id, timeout: 1, location }).catch(() => undefined)
      await reopened.waitForFrame((frame) => !/PID \d+/.test(frame), { maxPasses: 600 })
      await Bun.sleep(500)
      assert(!/PID \d+/.test(reopened.captureCharFrame()), "terminated shell must not keep a PID row")
      await reopened.mockInput.typeText("/exit")
      reopened.mockInput.pressEnter()
      await reboot.closed
      await reboot.done
    }

    if (scenario === "server") {
      // Restart the host: the interactive store lock is released, the shell
      // registry is gone, and the orphaned shell process is torn down with
      // the server it belonged to. The durable history still records the
      // shell as running, and that stale part must never render.
      host.stop.resolve()
      await host.done
      stage("first host stopped")
      try {
        process.kill(pid, "SIGKILL")
      } catch {}
      const gone = async () => {
        try {
          process.kill(pid, 0)
          return false
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === "ESRCH"
        }
      }
      for (let attempt = 0; attempt < 50 && !(await gone()); attempt++) await Bun.sleep(100)
      assert(await gone(), "the shell process is gone after the server restart")
      stage("shell process is gone")

      const restarted = startHost()
      const next = await restarted.endpoint
      stage("restarted host listening")
      const client2 = connect(next)
      const after = await client2.shell.list({ location })
      assert(!after.data.some((shell) => shell.status === "running"), "no live shell after the server restart")
      const history = await client2.message.list({ sessionID: session.id })
      assert(
        history.data.some((message) => message.type === "shell" && message.status === "running"),
        "the durable history still records the shell as running",
      )

      const reopened = await createTestRenderer({ width: 160, height: 40, useThread: false })
      reopened.renderer.start()
      setups.push(reopened)
      const reboot = bootTui(reopened, next, session.id)
      reboot.done.catch((error) => stage(`boot2 failed: ${error}`))
      await handoff(reboot)
      await reopened.waitForFrame((frame) => frame.includes("Process sidebar fixture"), { maxPasses: 600 })
      stage("reopened client rendered on the restarted host")
      await Bun.sleep(800)
      assert(
        !/PID \d+/.test(reopened.captureCharFrame()),
        "the restarted server must not render the prior shell as still running",
      )
      await dispatch(reopened, "/fixture-resync", (frame) => frame.includes("Process sidebar fixture"))
      await Bun.sleep(500)
      assert(
        !/PID \d+/.test(reopened.captureCharFrame()),
        "a fresh durable and live reconcile keeps the stale shell hidden",
      )
      await reopened.mockInput.typeText("/exit")
      reopened.mockInput.pressEnter()
      await reboot.closed
      await reboot.done
      restarted.stop.resolve()
      await restarted.done
    }
  }

  if (scenario === "lifecycle" || scenario === "resume") {
    setup.resize(100, 40)
    setup.resize(150, 45)
    await Bun.sleep(300)
    await setup.mockInput.typeText("/exit")
    setup.mockInput.pressEnter()
    await boot.closed
  }

  await boot.done
  host.stop.resolve()
  await host.done
})()

try {
  await task
  for (const testSetup of setups) assert.equal(testSetup.renderer.isDestroyed, true)
  console.log(`TUI_PROCESSES_${scenario.toUpperCase()}_OK`)
} catch (error) {
  console.error(error)
  for (const testSetup of setups) if (!testSetup.renderer.isDestroyed) console.error(testSetup.captureCharFrame())
  process.exitCode = 1
} finally {
  for (const testSetup of setups) if (!testSetup.renderer.isDestroyed) testSetup.renderer.destroy()
  await rm(root, { recursive: true, force: true })
  process.exit(process.exitCode ?? 0)
}
