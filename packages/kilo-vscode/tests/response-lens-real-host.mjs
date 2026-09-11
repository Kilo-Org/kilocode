#!/usr/bin/env node
// node tests/response-lens-real-host.mjs --case baseline
// node tests/response-lens-real-host.mjs --case candidate --candidate <packaged-dir-or-vsix>
// --case also accepts codex,official-codex,candidate-codex,candidate-agent-manager,candidate-geometry.
// No builds/installations/dependency downloads. Artifacts: fixture/runs/<unique-run>/.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { parseArgs } from "node:util"
import { writeFile, lstat } from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { once } from "node:events"
import { serve, sanitize } from "./response-lens-real-host-server.mjs"
import {
  defaults,
  fixture,
  prepare,
  copyPackage,
  fingerprint,
  collect,
  cleanup,
  inside,
} from "./response-lens-real-host-isolation.mjs"
import { startup, send, lens, history, codex } from "./response-lens-real-host-ui.mjs"
import { codexIsolation } from "./response-lens-real-host-codex.mjs"
import { localOnly } from "./response-lens-real-host-geometry.mjs"
import { foreground } from "./response-lens-real-host-focus.mjs"

const parsed = parseArgs({
  options: {
    case: { type: "string", default: "baseline" },
    candidate: { type: "string", default: process.env.RESPONSE_LENS_CANDIDATE },
    "candidate-sha256": { type: "string", default: process.env.RESPONSE_LENS_CANDIDATE_SHA256 },
    executable: { type: "string", default: defaults.executable },
    baseline: { type: "string", default: defaults.baseline },
    codex: { type: "string", default: defaults.codex },
    deps: { type: "string", default: process.env.RESPONSE_LENS_DEPS },
    turns: { type: "string", default: "16" },
    chars: { type: "string", default: "6000" },
    help: { type: "boolean", default: false },
    "cleanup-run": { type: "string" },
    "assert-badge-geometry": { type: "boolean", default: false },
  },
}).values
if (parsed.help) {
  console.log(
    "node tests/response-lens-real-host.mjs --case baseline|candidate|codex|official-codex|candidate-codex|candidate-agent-manager|candidate-geometry [--candidate <packaged-directory-or-vsix>] [--deps <package-directory>] [--turns 16] [--chars 6000] [--assert-badge-geometry]\nMultiple cases: comma-separated. Each case has a fresh isolated profile. Geometry and Agent Manager cases are focused smokes, not long-history claims. No real accounts or provider requests. Results and sanitized evidence remain in tests/fixtures/response-lens-real-host/runs; owned state/packages are removed in finally.",
  )
} else if (parsed["cleanup-run"]) {
  const root = path.resolve(parsed["cleanup-run"])
  assert.equal(path.dirname(root), path.join(fixture, "runs"), "Recovery can only remove one owned fixture run's state")
  const state = path.join(root, "state")
  const dirs = Object.fromEntries(["user-data", "data", "codex"].map((name) => [name, path.join(state, name)]))
  await collect({ root, state, dirs })
  await cleanup({ root, state })
  console.log(`Collected sanitized logs and removed owned state: ${root}`)
} else {
  const requireModule = createRequire(
    parsed.deps ? path.join(path.resolve(parsed.deps), "package.json") : import.meta.url,
  )
  const { _electron, expect } = requireModule("@playwright/test")
  const cases = parsed.case.split(",")
  assert.ok(
    cases.every((name) =>
      [
        "baseline",
        "candidate",
        "codex",
        "official-codex",
        "candidate-codex",
        "candidate-agent-manager",
        "candidate-geometry",
      ].includes(name),
    ),
  )
  const turns = Number(parsed.turns)
  const chars = Number(parsed.chars)
  assert.ok(Number.isInteger(turns) && turns >= 8 && turns <= 40, "Long history requires 8..40 real UI turns")
  assert.ok(Number.isInteger(chars) && chars >= 2000 && chars <= 12000, "Response length must be 2000..12000")
  assert.ok(
    !cases.some((name) => name.includes("candidate")) || parsed.candidate,
    "Candidate cases require an explicit packaged path",
  )
  await lstat(parsed.executable)
  for (const name of cases) {
    const server = await serve(chars)
    const run = await prepare(name, server, parsed).catch(async (error) => {
      await server.close()
      throw error
    })
    const result = {
      case: name,
      artifacts: run.root,
      started: new Date().toISOString(),
      status: "failed",
      gates: {},
      events: [],
      packages: [],
      limitations: [],
    }
    const event = (kind, text) => {
      if (result.events.length < 10000)
        result.events.push({ at: Date.now(), kind, text: sanitize(text).slice(0, 16000) })
    }
    const tagged = new WeakSet()
    const observe = (page) => {
      if (tagged.has(page)) return
      tagged.add(page)
      page.setDefaultTimeout(15000)
      page.on("console", (message) => event(`console-${message.type()}`, message.text()))
      page.on("pageerror", (error) => event("pageerror", error.stack || error.message))
      page.on("requestfailed", (request) =>
        event("requestfailed", `${request.method()} ${request.url()} ${request.failure()?.errorText}`),
      )
      page.on("crash", () => event("renderer-crash", "Owned renderer crashed"))
    }
    let app
    let page
    let original
    const started = performance.now()
    const watchdog = setTimeout(() => {
      result.deadlineExceeded = true
      event("deadline", "Six-minute per-case watchdog closed the owned application")
      app?.close().catch((error) => event("deadline-close-error", error.message))
    }, 360000)
    try {
      const candidate = name.includes("candidate")
      const kilo = name !== "codex"
      const coexist = name.includes("codex")
      const manager = name === "candidate-agent-manager"
      const focused = manager || name === "candidate-geometry"
      if (kilo) {
        const source = candidate ? parsed.candidate : parsed.baseline
        original = (await lstat(source)).isDirectory() ? await fingerprint(source) : undefined
        const pkg = await copyPackage(source, run, requireModule)
        if (candidate && parsed["candidate-sha256"])
          assert.equal(
            pkg.archive?.sha256,
            parsed["candidate-sha256"].toLowerCase(),
            "Sealed candidate SHA256 mismatch",
          )
        assert.equal(pkg.id, "kilocode.kilo-code")
        if (!candidate) assert.equal(pkg.version, "7.5.16")
        result.packages.push(pkg)
      }
      if (coexist) {
        const pkg = await copyPackage(parsed.codex, run, requireModule)
        result.packages.push(pkg)
        try {
          result.gates.codexIsolation = await codexIsolation(pkg.copy, run)
        } catch (error) {
          result.status = "blocked"
          throw new Error(`Refusing Codex extension activation: ${error.message}`)
        }
      }
      console.log(`[${name}] Launching real isolated Code.exe; evidence ${run.root}`)
      assert.ok(!result.deadlineExceeded, "Fixture preparation exceeded the case deadline")
      const launched = performance.now()
      result.preparationMs = launched - started
      result.launched = new Date().toISOString()
      app = await _electron.launch({
        executablePath: parsed.executable,
        cwd: run.dirs.workspace,
        args: run.args,
        env: run.env,
        timeout: 60000,
      })
      result.launcherPid = app.process().pid
      app.process().stdout?.on("data", (chunk) => event("stdout", chunk))
      app.process().stderr?.on("data", (chunk) => event("stderr", chunk))
      app.on("window", observe)
      app.windows().forEach(observe)
      // Require the native-window event before inspecting the main context.
      // Bootstrap failures still fail the run; no startup error is retried here.
      page = await app.firstWindow({ timeout: 60000 })
      observe(page)
      result.native = await app.evaluate(({ app }) => ({
        executable: process.execPath,
        userData: app.getPath("userData"),
        pid: process.pid,
        args: process.argv,
      }))
      assert.equal(path.resolve(result.native.executable).toLowerCase(), path.resolve(parsed.executable).toLowerCase())
      assert.equal(path.resolve(result.native.userData), run.dirs["user-data"])
      // Playwright uses a cmd.exe launcher on Windows; ownership is established by
      // the native executable and this run's unique user-data/extensions switches.
      assert.ok(result.native.args.includes(`--extensions-dir=${run.dirs.extensions}`))
      result.pid = result.native.pid
      assert.ok(!result.native.args.some((arg) => arg.startsWith("--extensionDevelopmentPath")))
      const host = await server.host()
      assert.ok(inside(run.root, host.storage))
      result.gates.extensionHost = { status: "passed", readyMs: performance.now() - launched, ...host }
      if (coexist) result.gates.codex = await codex(page, server, expect, run)
      if (kilo) {
        const frame = await startup(page, server, expect, run, "cold", manager)
        result.gates.startup = { status: "passed", readyMs: performance.now() - launched }
        const first = await send(frame, page, expect, 1)
        if (manager)
          result.gates.agentManager = {
            status: "chat-passed",
            ...(await localOnly(run, await first.row.getAttribute("data-session"))),
          }
        result.gates.ordinaryPrompt = { status: "passed", latencyMs: first.latency }
        if (focused)
          result.gates.history = {
            status: "not-run",
            reason: "Focused geometry or LOCAL smoke; use candidate for the unchanged long-history gate",
          }
        else {
          result.gates.history = {
            status: "passed",
            charsPerResponse: chars,
            ...(await history(frame, page, expect, turns, app, run)),
          }
          assert.ok(
            server.calls.some((call) => call.messages >= 2 * (turns + 1) && call.bytes >= turns * chars),
            "Long-history provider request did not retain the real conversation",
          )
          await page.screenshot({ path: path.join(run.root, "long-history.png") })
        }
        if (candidate) {
          await foreground(app, page, frame, run, "selection")
          const latest = frame
            .locator('[data-row="assistant"]')
            .filter({ hasText: `RL_REPLY_${String(focused ? 1 : turns + 1).padStart(4, "0")}.` })
            .last()
          await lens(frame, page, latest, expect, server, run)
          result.gates.responseLens = { status: "passed" }
        }
        const count = server.hosts.length
        await server.command({ command: "workbench.action.reloadWindow" })
        await server.host(count + 1)
        if (coexist) result.gates.codexReload = await codex(page, server, expect, run)
        const reloaded = await startup(page, server, expect, run, "reload", manager)
        if (candidate) {
          await expect(reloaded.getByRole("button", { name: "Annotation #1", exact: true })).toBeVisible({
            timeout: 60000,
          })
          const settings = (await server.command()).settings
          assert.equal(settings?.level, "university")
        }
        await send(reloaded, page, expect, focused ? 2 : turns + 2)
        result.gates.reload = {
          status: "passed",
          savedNumber: candidate ? 1 : "not-applicable",
          settingsPersisted: candidate,
        }
        result.gates.agentManager = manager
          ? {
              ...result.gates.agentManager,
              status: "passed",
              selection: true,
              annotation: true,
              explanation: true,
              reload: true,
            }
          : {
              status: "not-tested",
              reason: "Sidebar is the required gate; Agent Manager is not implied by sidebar results",
            }
        if (parsed["assert-badge-geometry"])
          assert.equal(
            run.visuals?.singleBadge?.unnecessaryVerticalOverflow,
            false,
            "Single source badge has unnecessary vertical overflow",
          )
      }
      const failures = result.events.filter((entry) => entry.kind === "pageerror" || entry.kind === "renderer-crash")
      assert.equal(failures.length, 0, `Uncaught renderer failures: ${JSON.stringify(failures)}`)
      assert.ok(!result.deadlineExceeded, "Case exceeded the six-minute bound")
      result.status = "passed"
    } catch (error) {
      result.error = sanitize(error.stack || String(error))
      console.error(`[${name}] ${result.status}: ${sanitize(error.message)}`)
      if (page && !page.isClosed()) {
        await page
          .screenshot({ path: path.join(run.root, "failure.png") })
          .catch((error) => event("capture-error", error.message))
        result.frames = await Promise.all(
          page.frames().map(async (frame) => ({
            url: sanitize(frame.url()),
            text: sanitize(
              await frame
                .locator("body")
                .innerText({ timeout: 1000 })
                .catch((error) => error.message),
            ).slice(0, 12000),
          })),
        )
      }
    } finally {
      clearTimeout(watchdog)
      if (app) {
        const process = app.process()
        try {
          await Promise.race([
            app.close(),
            once(AbortSignal.timeout(30000), "abort").then(() => {
              throw new Error("Owned application did not close within 30s")
            }),
          ])
          result.cleanup = {
            method: "ElectronApplication.close",
            pid: result.pid,
            exited: process.exitCode !== null || process.signalCode !== null,
          }
        } catch (error) {
          event("cleanup-warning", error.message)
          if (process.exitCode === null && process.signalCode === null) {
            // Only the exact newly spawned PID, never an image-name/global kill.
            await promisify(execFile)("taskkill.exe", ["/PID", String(result.pid), "/T", "/F"], {
              windowsHide: true,
              timeout: 15000,
            }).catch((error) => event("cleanup-error", error.message))
          }
          result.cleanup = {
            method: "owned-PID-tree fallback",
            pid: result.pid,
            exited: process.exitCode !== null || process.signalCode !== null,
          }
        }
        if (!result.cleanup.exited) result.status = "failed"
      }
      await collect(run).catch((error) => event("log-collection-error", error.message))
      result.provider = { requests: server.calls, blockedExternalRequests: server.blocked }
      await server.close()
      if (original) {
        const current = await fingerprint(original.source)
        result.sourceUnchanged = JSON.stringify(current.hashes) === JSON.stringify(original.hashes)
        if (!result.sourceUnchanged) {
          result.status = "failed"
          result.error = "Read-only package source changed during run"
        }
      }
      await writeFile(path.join(run.root, "events.json"), JSON.stringify(result.events, null, 2))
      await writeFile(
        path.join(run.root, "pageerrors.json"),
        JSON.stringify(
          result.events.filter((entry) => entry.kind === "pageerror" || entry.kind === "renderer-crash"),
          null,
          2,
        ),
      )
      await writeFile(
        path.join(run.root, "failed-requests.json"),
        JSON.stringify(
          result.events.filter((entry) => entry.kind === "requestfailed"),
          null,
          2,
        ),
      )
      result.diagnostics = {
        pageerrors: result.events.filter((entry) => entry.kind === "pageerror").length,
        failedRequests: result.events.filter((entry) => entry.kind === "requestfailed").length,
        featureErrors: result.events.filter((entry) => /Response Lens view failed/.test(entry.text)),
      }
      result.visuals = run.visuals
      if (run.visuals?.singleBadge)
        result.gates.badgeGeometry = {
          status: run.visuals.singleBadge.unnecessaryVerticalOverflow ? "failed" : "passed",
          enforced: parsed["assert-badge-geometry"],
          clusterClientHeight: run.visuals.singleBadge.cluster.clientHeight,
          clusterScrollHeight: run.visuals.singleBadge.cluster.scrollHeight,
          badgeHeight: run.visuals.singleBadge.badge.offsetHeight,
          badgeMinHeight: run.visuals.singleBadge.badge.minHeight,
        }
      delete result.events
      result.elapsedMs = performance.now() - started
      await cleanup(run).catch((error) => {
        result.cleanupError = sanitize(error.message)
        result.status = "failed"
      })
      result.isolation = {
        freshProfile: true,
        copiedProfiles: false,
        inheritedEnvironment: false,
        directories: run.dirs,
        stateRemoved: !result.cleanupError,
      }
      await writeFile(path.join(run.root, "result.json"), JSON.stringify(result, null, 2))
      console.log(
        JSON.stringify(
          { case: name, status: result.status, artifacts: run.root, gates: result.gates, error: result.error },
          null,
          2,
        ),
      )
      if (result.status !== "passed") process.exitCode = 1
    }
  }
}
