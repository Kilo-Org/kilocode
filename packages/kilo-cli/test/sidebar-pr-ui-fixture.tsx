import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { run as runTui, type TuiInput } from "@opencode-ai/tui"
import { Global } from "@opencode-ai/util/global"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import assert from "node:assert/strict"
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"
import { createTuiConfig } from "../src/tui-config"

const scenario = process.env.TUI_PR_SCENARIO
assert(
  scenario === "found" ||
    scenario === "stale" ||
    scenario === "nopr" ||
    scenario === "nogh" ||
    scenario === "sha" ||
    scenario === "sha-wrong" ||
    scenario === "parent" ||
    scenario === "parent-sha",
)

const setup = await createTestRenderer({ width: 160, height: 40, useThread: false })
setup.renderer.start()

const root = await mkdtemp(path.join(os.tmpdir(), "kilo-pr-fixture-"))
const repo = path.join(root, "repo")
const repo2 = path.join(root, "repo2")
const shim = path.join(root, "shim")
const tools = path.join(root, "tools")
const plugins = path.join(root, "plugins", "pr-fixture")
const log = path.join(root, "gh-calls.log")
await Promise.all([repo, repo2, shim, tools, plugins].map((directory) => mkdir(directory, { recursive: true })))

const gitBinary = Bun.which("git")
const bunBinary = Bun.which("bun")
assert(gitBinary && bunBinary, "fixture requires git and bun on PATH")
const bunBin = path.dirname(bunBinary)
// Symlink the real git into an isolated tools dir: the PATH restriction must
// hide the host's gh (typically installed next to homebrew git) while keeping
// a working git for the producer and the fixture.
await symlink(gitBinary, path.join(tools, "git"))

const restrictedPath = [scenario === "nogh" ? null : shim, tools, bunBin, "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
  .filter((entry): entry is string => entry !== null)
  .join(":")
process.env.PATH = restrictedPath
if (scenario === "nogh")
  assert.equal(Bun.which("gh", { PATH: process.env.PATH }), null, "gh must be unavailable in the nogh scenario")

const shimScript = `#!/bin/bash
echo "gh $*" >> "$TUI_PR_SHIM_LOG"
mode="$TUI_PR_MODE"
if [ "$1" = "repo" ]; then
  if [ "$mode" = "parent" ] || [ "$mode" = "parent-sha" ]; then
    echo '{"nameWithOwner": "fixture/origin", "parent": {"nameWithOwner": "fixture/upstream"}}'
    exit 0
  fi
  exit 1
fi
if [ "\$1" = "pr" ] && [ "\$2" = "list" ]; then
  has_repo=0
  has_head=0
  has_search=0
  for arg in "\$@"; do
    case "\$arg" in
      -R) has_repo=1 ;;
      --head) has_head=1 ;;
      --search) has_search=1 ;;
    esac
  done
  kind=""
  if [ "\$has_repo" = "1" ]; then kind="repo-"; fi
  if [ "\$has_head" = "1" ]; then kind="\${kind}head"
  elif [ "\$has_search" = "1" ]; then kind="\${kind}search"
  fi
  payload=""
  if [ "\$mode" = "sha" ] && [ "\$kind" = "search" ]; then
    payload="[{\\"number\\": 3, \\"title\\": \\"SHA matched\\", \\"headRefOid\\": \\"\$TUI_PR_HEAD\\"}]"
  elif [ "\$mode" = "sha-wrong" ] && [ "\$kind" = "search" ]; then
    payload="[{\\"number\\": 4, \\"title\\": \\"Wrong head\\", \\"headRefOid\\": \\"ffffffffffffffffffffffffffffffffffffffff\\"}]"
  elif [ "\$mode" = "parent" ] && [ "\$kind" = "repo-head" ]; then
    payload="[{\\"number\\": 5, \\"title\\": \\"Parent head matched\\", \\"headRefOid\\": \\"\$TUI_PR_HEAD\\"}]"
  elif [ "\$mode" = "parent-sha" ] && [ "\$kind" = "repo-search" ]; then
    payload="[{\\"number\\": 6, \\"title\\": \\"Fork sha matched\\", \\"headRefOid\\": \\"\$TUI_PR_HEAD\\"}]"
  fi
  if [ -n "\$payload" ]; then
    echo "\$payload"
    exit 0
  fi
  exit 1
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  branch=""
  if [ -n "$3" ] && [ "\${3#-}" = "$3" ]; then branch="$3"; fi
  if [ "$mode" != "pr" ]; then exit 1; fi
  case "$branch" in
    main)
      if [ -n "$TUI_PR_MAIN_DELAY" ]; then sleep "$TUI_PR_MAIN_DELAY"; fi
      echo '{"number": 2, "title": "Adjust sidebar rendering for remarkably long pull request titles"}'
      exit 0
      ;;
    bravo-repo)
      if [ -n "$TUI_PR_BRAVO_DELAY" ]; then sleep "$TUI_PR_BRAVO_DELAY"; fi
      echo '{"number": 7, "title": "Bravo fix"}'
      exit 0
      ;;
    *)
      exit 1
      ;;
  esac
fi
exit 1
`
await writeFile(path.join(shim, "gh"), shimScript)
await chmod(path.join(shim, "gh"), 0o755)
process.env.TUI_PR_SHIM_LOG = log
const shimMode = scenario === "found" || scenario === "stale" ? "pr" : scenario === "nopr" ? "empty" : scenario
process.env.TUI_PR_MODE = shimMode
if (scenario === "stale") process.env.TUI_PR_MAIN_DELAY = "1.5"
if (scenario === "found") process.env.TUI_PR_BRAVO_DELAY = "2"

const git = (args: string[], cwd: string) => {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: process.env, stdout: "pipe", stderr: "pipe" })
  assert.equal(result.exitCode, 0, `git ${args.join(" ")} failed: ${result.stderr.toString()}`)
  return result.stdout.toString().trim()
}
for (const [directory, branch] of [
  [repo, "main"],
  [repo2, "bravo-repo"],
] as const) {
  git(["init", "-b", branch], directory)
  git(["config", "user.email", "fixture@example.com"], directory)
  git(["config", "user.name", "Fixture"], directory)
  git(["commit", "--allow-empty", "-m", "one"], directory)
}
process.env.TUI_PR_HEAD = git(["rev-parse", "HEAD"], repo)

const productionModule = path.resolve(import.meta.dir, "../src/tui-plugin/sidebar-pr.tsx")
await writeFile(
  path.join(plugins, "package.json"),
  JSON.stringify(
    {
      name: "kilo.pr-fixture",
      version: "0.0.0-internal",
      private: true,
      type: "module",
      exports: { "./tui": "./tui.tsx" },
    },
    null,
    2,
  ),
)
await writeFile(
  path.join(plugins, "tui.tsx"),
  `import path from "node:path"\nimport { installPrSidebar } from ${JSON.stringify(productionModule)}\n\nexport default {\n  id: "kilo.pr-fixture",\n  setup(ctx) {\n    installPrSidebar(ctx, {})\n    ctx.ui.slot({\n      append: "app",\n      render: () => {\n        ctx.keymap.layer(() => ({\n          mode: "global",\n          commands: [\n            {\n              id: "kilo.pr-fixture.tab",\n              title: "Open second fixture tab",\n              slash: { name: "fixture-tab" },\n              run: async () => {\n                const sibling = path.join(path.dirname(ctx.location.directory), "repo2")\n                const second = await ctx.client.session.create({\n                  title: "Second fixture session",\n                  location: { directory: sibling },\n                })\n                ctx.ui.tabs.open(second.id)\n              },\n            },\n          ],\n        }))\n        return null\n      },\n    })\n  },\n}\n`,
)

async function ghCalls() {
  const content = await Bun.file(log)
    .text()
    .catch(() => "")
  return content.split("\n").filter((line) => line.startsWith("gh "))
}

async function waitForLog(predicate: (calls: string[]) => boolean, label: string) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (predicate(await ghCalls())) return
    await Bun.sleep(100)
  }
  assert.fail(
    `gh call log never satisfied: ${label}\n${await Bun.file(log)
      .text()
      .catch(() => "")}`,
  )
}

const ready = Promise.withResolvers<void>()
const closed = Promise.withResolvers<void>()

const task = Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const input = layout("interactive")
      const endpoint = yield* launch(input, { models: false, recover: false })
      const client = createClient({
        baseUrl: endpoint.url,
        headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
      })
      const location = { directory: repo }
      const session = yield* Effect.promise(() => client.session.create({ title: "PR sidebar fixture", location }))
      yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
      const config = createTuiConfig(input, {
        plugins: [],
        session: { terminal: false },
        attention: { enabled: false },
        terminal: { title: false },
      })
      const tuiInput: TuiInput = {
        app: { name: "kilo2", version: "0.0.0-fixture", channel: input.channel },
        server: { endpoint },
        args: { sessionID: session.id },
        config,
        packages: {
          prepare: async () => {
            throw new Error("No package plugins are expected in the PR fixture")
          },
        },
        pluginDirectories: [path.dirname(plugins)],
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark" as const, complete: ready.resolve }),
      }
      const fiber = yield* Effect.forkScoped(
        runTui(tuiInput).pipe(
          Effect.provide(Global.layerWith(input.paths)),
          Effect.ensuring(Effect.sync(closed.resolve)),
        ),
      )
      yield* Effect.tryPromise(async () => {
        await Promise.race([
          ready.promise,
          closed.promise.then(() => {
            throw new Error("TUI closed before terminal handoff")
          }),
        ])
        await setup.waitForFrame((frame) => frame.includes("PR sidebar fixture"), { maxPasses: 600 })

        if (scenario === "found") {
          await waitForLog((calls) => calls.some((call) => call.includes("pr view main")), "pr view main")
          await setup.waitForFrame((frame) => frame.includes("PR #2 - Adjust sidebar rendering"), { maxPasses: 600 })
          const wide = setup.captureCharFrame()
          const line = wide.split("\n").find((entry) => entry.includes("PR #2"))
          assert(line, "PR line rendered")
          assert(!line.includes("titles"), `long title must wrap, rendered one line: ${line}`)
          assert(wide.includes("request titles"), "wrapped title tail must stay visible")
          const mounted = (await ghCalls()).filter((call) => call.includes("pr view main")).length
          setup.resize(100, 40)
          await setup.waitForFrame((frame) => !frame.includes("PR #2"), { maxPasses: 600 })
          setup.resize(140, 45)
          await setup.waitForFrame((frame) => frame.includes("PR #2"), { maxPasses: 600 })
          // Hiding the sidebar unmounts the section, so the fresh mount performs
          // exactly one new lookup; a width change that keeps it mounted must not.
          assert.equal(
            (await ghCalls()).filter((call) => call.includes("pr view main")).length,
            mounted + 1,
            "hide/show cycle must re-lookup once, not per frame",
          )
          setup.resize(150, 45)
          await Bun.sleep(500)
          assert(setup.captureCharFrame().includes("PR #2"), "PR line survives a keeping-width resize")
          assert.equal(
            (await ghCalls()).filter((call) => call.includes("pr view main")).length,
            mounted + 1,
            "a keeping-width resize must not re-invoke gh",
          )
          // Leave a lookup in flight (delayed shim) and shut the TUI down on top
          // of it: cleanup must abort it and exit cleanly.
          await setup.mockInput.typeText("/fixture-tab")
          setup.mockInput.pressEnter()
          await waitForLog((calls) => calls.some((call) => call.includes("pr view bravo-repo")), "pr view bravo-repo")
        }

        if (scenario === "stale") {
          await waitForLog((calls) => calls.some((call) => call.includes("pr view main")), "pr view main")
          // The real v2 supersede path: switching tabs changes the viewed
          // location identity, which aborts the in-flight main lookup before its
          // delayed response can render.
          await setup.mockInput.typeText("/fixture-tab")
          setup.mockInput.pressEnter()
          await setup.waitForFrame((frame) => frame.includes("PR #7 - Bravo fix"), { maxPasses: 600 })
          await Bun.sleep(2500)
          const settled = setup.captureCharFrame()
          assert(settled.includes("PR #7 - Bravo fix"), "current location PR must stay rendered")
          assert(!settled.includes("PR #2"), "superseded main response must never render")
          const calls = await ghCalls()
          assert.equal(
            calls.filter((call) => call.includes("pr view main")).length,
            1,
            "superseded lookup must not retry",
          )
        }

        if (scenario === "nopr") {
          await waitForLog((calls) => calls.some((call) => call.includes("pr view main")), "pr view main")
          await Bun.sleep(1500)
          assert(!setup.captureCharFrame().includes("PR #"), "no PR must render when gh reports none")
        }

        if (scenario === "nogh") {
          await Bun.sleep(1500)
          assert(!setup.captureCharFrame().includes("PR #"), "no PR must render without gh")
          assert.equal(
            (
              await Bun.file(log)
                .text()
                .catch(() => "")
            ).length,
            0,
            "shim must never be called",
          )
        }

        if (scenario === "sha") {
          await waitForLog((calls) => calls.some((call) => call.includes("--search")), "pr list --search")
          await setup.waitForFrame((frame) => frame.includes("PR #3 - SHA matched"), { maxPasses: 600 })
        }

        if (scenario === "sha-wrong") {
          await waitForLog((calls) => calls.some((call) => call.includes("--search")), "pr list --search")
          await Bun.sleep(1500)
          const settled = setup.captureCharFrame()
          assert(!settled.includes("PR #"), "a PR with a different head SHA must never render")
          assert(!settled.includes("Wrong head"), "the wrong-head PR payload must not leak into the frame")
        }

        if (scenario === "parent") {
          await waitForLog(
            (calls) => calls.some((call) => call.includes("repo view") && call.includes("nameWithOwner")),
            "gh repo view",
          )
          await setup.waitForFrame((frame) => frame.includes("PR #5 - Parent head matched"), { maxPasses: 600 })
        }

        if (scenario === "parent-sha") {
          await waitForLog(
            (calls) => calls.filter((call) => call.includes("pr list")).length >= 2,
            "both pr list fallbacks",
          )
          await setup.waitForFrame((frame) => frame.includes("PR #6 - Fork sha matched"), { maxPasses: 600 })
        }

        await setup.mockInput.typeText("/exit")
        setup.mockInput.pressEnter()
        await closed.promise
      })
      yield* Fiber.join(fiber)
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
)

try {
  await task
  assert.equal(setup.renderer.isDestroyed, true)
  console.log(`TUI_PR_${scenario.toUpperCase()}_OK`)
} catch (error) {
  console.error(error)
  if (!setup.renderer.isDestroyed) console.error(setup.captureCharFrame())
  process.exitCode = 1
} finally {
  if (!setup.renderer.isDestroyed) setup.renderer.destroy()
  await rm(root, { recursive: true, force: true })
}
