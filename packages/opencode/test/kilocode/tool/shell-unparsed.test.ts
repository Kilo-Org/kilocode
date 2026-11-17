// Regression tests for Kilo-Org/kilocode#12326.
//
// tree-sitter-powershell dropped commands containing a bare `--` (for example
// `git checkout -- <file>`) into ERROR nodes instead of command nodes, so the
// shell permission scanner collected zero patterns and the command executed
// with no permission evaluation at all, bypassing every bash rule including
// `"git *": "deny"` and `"*": "deny"`. The scanner now fails closed: failed
// command text is recovered from ERROR nodes, and any parse with errors that
// recovered nothing falls back to the raw command text (also covering ERROR
// chunks without a command_name descendant, such as backtick escapes).

import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Permission } from "../../../src/permission"
import { ShellPermission } from "../../../src/tool/shell"
import { ShellTool } from "../../../src/tool/shell"
import { Shell } from "@opencode-ai/core/shell"
import { Config } from "../../../src/config/config"
import { Agent } from "../../../src/agent/agent"
import { Plugin } from "../../../src/plugin"
import { Truncate } from "../../../src/tool/truncate"
import { RuntimeFlags } from "../../../src/effect/runtime-flags"
import { SessionID, MessageID } from "../../../src/session/schema"
import { disposeAllInstances, provideInstance, testInstanceStoreLayer, tmpdir } from "../../fixture/fixture"
import { afterEach } from "bun:test"

const layer = Layer.mergeAll(
  AppNodeBuilder.build(CrossSpawnSpawner.node),
  AppNodeBuilder.build(FSUtil.node),
  testInstanceStoreLayer,
)

type ScanRequest = Omit<PermissionV1.Request, "id" | "sessionID" | "tool">

async function scan(dir: string, command: string, shell: string, sandbox = false) {
  const requests: ScanRequest[] = []
  const ctx = {
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_test"),
    callID: "",
    agent: "code",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (req: ScanRequest) =>
      Effect.sync(() => {
        requests.push(req)
      }),
  }
  await Effect.runPromise(
    provideInstance(dir)(
      Effect.gen(function* () {
        const permission = yield* ShellPermission
        yield* permission.ask(ctx, { command, cwd: dir, shell, description: "test", escalate: sandbox })
      }),
    ).pipe(Effect.provide(layer)),
  )
  return requests
}

function patterns(requests: ScanRequest[]) {
  return requests.filter((req) => req.permission === "bash").flatMap((req) => req.patterns)
}

const deny = Permission.fromConfig({
  "*": "ask",
  bash: {
    "*": "ask",
    "git *": "deny",
  },
})

function action(pattern: string) {
  return Permission.evaluate("bash", pattern, deny).action
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("shell permission scanner fails closed on unparsed commands", () => {
  test("asks separately before mutating Git when the session sandbox is enabled", async () => {
    await using tmp = await tmpdir({ git: true })
    const requests = await scan(tmp.path, "git add . && git commit -m test", "bash", true)
    expect(requests.map((request) => request.permission)).toEqual(["bash", "sandbox_escalation"])
    expect(requests[1]?.metadata?.sandboxEscalation).toBe(true)
  })

  test("does not escalate read-only Git commands when the session sandbox is enabled", async () => {
    await using tmp = await tmpdir({ git: true })
    const requests = await scan(tmp.path, "git remote -v && git stash list && git branch -v", "bash", true)
    expect(requests.map((request) => request.permission)).toEqual(["bash"])
  })

  test("pwsh: bare '--' git commands now produce a denied pattern", async () => {
    await using tmp = await tmpdir()
    for (const command of ["git checkout -- file", "git restore -- file", "git log -- file", "git checkout -- ."]) {
      const found = patterns(await scan(tmp.path, command, "pwsh"))
      expect(found.length).toBeGreaterThan(0)
      expect(found.map(action)).toContain("deny")
    }
  })

  test("pwsh: bare '--' in a chained command no longer vanishes from the check", async () => {
    await using tmp = await tmpdir()
    const found = patterns(await scan(tmp.path, "git checkout -- file; git status", "pwsh"))
    expect(found).toContain("git status")
    expect(found.some((pattern) => pattern.includes("git checkout -- file"))).toBe(true)
    expect(found.map(action)).toContain("deny")
  })

  test("pwsh: bare '--' in non-git commands produces a pattern that falls back to ask", async () => {
    await using tmp = await tmpdir()
    for (const command of ["npm run build -- --watch", "echo -- hi", "rm -rf -- file"]) {
      const found = patterns(await scan(tmp.path, command, "pwsh"))
      expect(found.length).toBeGreaterThan(0)
      expect(found.map(action)).toContain("ask")
    }
  })

  test("pwsh: valid commands are unchanged (no extra patterns, no new prompts)", async () => {
    await using tmp = await tmpdir()
    expect(patterns(await scan(tmp.path, "git status", "pwsh"))).toEqual(["git status"])
    expect(patterns(await scan(tmp.path, 'git checkout "--" file', "pwsh"))).toEqual(['git checkout "--" file'])
    const found = patterns(await scan(tmp.path, "Write-Host foo; if ($?) { Write-Host bar }", "pwsh"))
    expect(found).toContain("Write-Host foo")
    expect(found).toContain("Write-Host bar")
    expect(found.length).toBe(2)
  })

  test("pwsh: a dot-prefixed argument after -- or a comma stays on its command (#15938)", async () => {
    await using tmp = await tmpdir()
    const commands = [
      "Write-Output -- .agents/README.md",
      "Write-Output -- .venv/Scripts/python.exe --version",
      "git ls-files -- README.md .agents/README.md",
      "Get-FileHash -LiteralPath package.json, .gitattributes",
      "Write-Output x, .venv/Scripts/python.exe --version",
      "git push origin -- .foo -f",
      "Remove-Item -- .foo/../x",
    ]
    for (const command of commands) {
      const found = patterns(await scan(tmp.path, command, "pwsh"))
      expect(found).toContain(command)
      expect(found.some((pattern) => pattern.startsWith("."))).toBe(false)
    }
  })

  test("pwsh: a later pipeline command keeps its own check (#15938)", async () => {
    await using tmp = await tmpdir()
    const found = patterns(await scan(tmp.path, "Write-Output -- .agents/README.md | Out-String", "pwsh"))
    expect(found).toContain("Write-Output -- .agents/README.md")
    expect(found).toContain("Out-String")
    expect(found).not.toContain("Write-Output -- .agents/README.md | Out-String")

    const written = await scan(tmp.path, "git status -- .x | Set-Content -Path ../outside.txt", "pwsh")
    const writtenPatterns = patterns(written)
    expect(writtenPatterns.some((pattern) => pattern.includes("git status -- .x"))).toBe(true)
    expect(writtenPatterns.some((pattern) => pattern.includes("Set-Content"))).toBe(true)
    expect(written.some((request) => request.permission === "external_directory")).toBe(true)
  })

  test("pwsh: an identical later parse error is still checked (#15938)", async () => {
    await using tmp = await tmpdir()
    const found = patterns(await scan(tmp.path, "git checkout -- README .foo; git checkout -- README", "pwsh"))
    expect(found.some((pattern) => pattern.includes("git checkout -- README .foo"))).toBe(true)
    expect(found.some((pattern) => pattern.includes("git checkout -- README") && !pattern.includes(".foo"))).toBe(true)
  })

  test("pwsh: a reconstructed git push still escalates the sandbox (#15938)", async () => {
    await using tmp = await tmpdir({ git: true })
    const requests = await scan(tmp.path, "git push origin -- .foo -f", "pwsh", true)
    expect(requests.map((request) => request.permission)).toContain("sandbox_escalation")
  })

  test("pwsh: allow-always can persist the reconstructed command (#15938)", async () => {
    await using tmp = await tmpdir()
    const requests = await scan(tmp.path, "Write-Output -- .agents/README.md", "pwsh")
    const bash = requests.find((request) => request.permission === "bash")
    expect(bash?.always).toContain("Write-Output *")
  })

  test("pwsh: a dot-prefixed argument does not swallow the next statement (#15938)", async () => {
    await using tmp = await tmpdir()
    const found = patterns(await scan(tmp.path, "Write-Output -- .agents/README.md; Get-ChildItem", "pwsh"))
    expect(found).toContain("Write-Output -- .agents/README.md")
    expect(found).toContain("Get-ChildItem")
    expect(found.some((pattern) => pattern === ".agents/README.md")).toBe(false)

    const sourced = patterns(await scan(tmp.path, "Write-Output -- .agents/README.md; . ./script.ps1", "pwsh"))
    expect(sourced).toContain("Write-Output -- .agents/README.md")
    expect(sourced.some((pattern) => pattern.includes("./script.ps1"))).toBe(true)

    const lines = patterns(await scan(tmp.path, "Write-Output hello\n.agents/foo", "pwsh"))
    expect(lines).toContain("Write-Output hello")
    expect(lines).toContain(".agents/foo")

    const separated = patterns(await scan(tmp.path, "Write-Output hello; .agents/foo", "pwsh"))
    expect(separated).toContain("Write-Output hello")
    expect(separated).toContain(".agents/foo")
  })

  test("pwsh: whitespace stays silent, comment-only input is checked instead of trusted", async () => {
    await using tmp = await tmpdir()
    expect(patterns(await scan(tmp.path, "   ", "pwsh"))).toEqual([])
    expect(patterns(await scan(tmp.path, "# comment only", "pwsh"))).toEqual(["# comment only"])
  })

  test("bash grammar: behavior is unchanged for direct, chained, and location commands", async () => {
    await using tmp = await tmpdir()
    expect(patterns(await scan(tmp.path, "git checkout -- file", "bash"))).toEqual(["git checkout -- file"])
    const chained = patterns(await scan(tmp.path, `cd ${tmp.path} && git checkout -- file`, "bash"))
    expect(chained).toEqual(["git checkout -- file"])
    expect(patterns(await scan(tmp.path, `cd ${tmp.path}`, "bash"))).toEqual([])
  })

  test("cmd-kind: bare '--' git commands still produce a denied pattern", async () => {
    await using tmp = await tmpdir()
    const found = patterns(await scan(tmp.path, "git checkout -- file", "cmd"))
    expect(found).toEqual(["git checkout -- file"])
    expect(found.map(action)).toContain("deny")
  })

  test("pwsh: runnable text in an ERROR node without command_name falls back to the raw check", async () => {
    await using tmp = await tmpdir()
    // PowerShell interprets `n as a newline escape, so this input executes
    // `git checkout -- file`, but the grammar drops that segment into an ERROR
    // node with no command_name descendant while `echo ok` parses cleanly.
    const found = patterns(await scan(tmp.path, "echo ok; `ngit checkout -- file", "pwsh"))
    expect(found).toContain("echo ok; `ngit checkout -- file")
    expect(found.map(action)).toContain("ask")
  })

  test("pwsh: partially parsed pipelines still fail closed with the raw text", async () => {
    await using tmp = await tmpdir()
    const found = patterns(await scan(tmp.path, "git checkout -- file | cat", "pwsh"))
    expect(found).toContain("git checkout -- file | cat")
    expect(found.map(action)).toContain("deny")
  })
})

const execLayer = Layer.mergeAll(
  AppNodeBuilder.build(CrossSpawnSpawner.node),
  AppNodeBuilder.build(FSUtil.node),
  AppNodeBuilder.build(Plugin.node),
  AppNodeBuilder.build(Truncate.node),
  AppNodeBuilder.build(Config.node),
  AppNodeBuilder.build(Agent.node),
  AppNodeBuilder.build(RuntimeFlags.node),
  testInstanceStoreLayer,
)

const powershells =
  process.platform === "win32"
    ? [Bun.which("pwsh"), Bun.which("powershell")].filter((shell): shell is string => Boolean(shell))
    : []

async function withShell<R>(shell: string, fn: () => Promise<R>) {
  const prev = process.env.SHELL
  process.env.SHELL = shell
  Shell.acceptable.reset()
  Shell.preferred.reset()
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env.SHELL
    if (prev !== undefined) process.env.SHELL = prev
    Shell.acceptable.reset()
    Shell.preferred.reset()
  }
}

// End-to-end coverage through the real shell tool and a real PowerShell binary.
// Runs only on the Windows CI runners, where pwsh/powershell exist.
describe("full tool execution through real powershell (windows only)", () => {
  for (const shell of powershells) {
    test(`asks for permission on a bare double dash command [${path.basename(shell, ".exe")}]`, async () => {
      await using tmp = await tmpdir()
      const requests: ScanRequest[] = []
      const stop = new Error("stop after permission")
      await withShell(shell, () =>
        Effect.runPromise(
          provideInstance(tmp.path)(
            Effect.gen(function* () {
              const info = yield* ShellTool
              const tool = yield* info.init()
              const exit = yield* tool
                .execute(
                  { command: "git checkout -- file", description: "Restore a file from git" },
                  {
                    sessionID: SessionID.make("ses_test"),
                    messageID: MessageID.make("msg_test"),
                    callID: "",
                    agent: "code",
                    abort: AbortSignal.any([]),
                    messages: [],
                    metadata: () => Effect.void,
                    ask: (req: ScanRequest) =>
                      Effect.sync(() => {
                        requests.push(req)
                        throw stop
                      }),
                  },
                )
                .pipe(Effect.exit)
              const err = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
              expect(err instanceof Error && err.message).toBe(stop.message)
            }),
          ).pipe(Effect.provide(execLayer)),
        ),
      )
      const req = requests.find((r) => r.permission === "bash")
      expect(req).toBeDefined()
      expect(req!.patterns).toContain("git checkout -- file")
    })
  }
})
