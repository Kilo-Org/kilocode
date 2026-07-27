// Regression tests for Kilo-Org/kilocode#12326.
//
// tree-sitter-powershell dropped commands containing a bare `--` (for example
// `git checkout -- <file>`) into ERROR nodes instead of command nodes, so the
// shell permission scanner collected zero patterns and the command executed
// with no permission evaluation at all, bypassing every bash rule including
// `"git *": "deny"` and `"*": "deny"`. The scanner now fails closed: failed
// command text is recovered from ERROR nodes, and a non-empty command that
// produced no command nodes falls back to its raw text.

import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Permission } from "../../../src/permission"
import { ShellPermission } from "../../../src/tool/shell"
import { SessionID, MessageID } from "../../../src/session/schema"
import { disposeAllInstances, provideInstance, testInstanceStoreLayer, tmpdir } from "../../fixture/fixture"
import { afterEach } from "bun:test"

const layer = Layer.mergeAll(CrossSpawnSpawner.defaultLayer, FSUtil.defaultLayer, testInstanceStoreLayer)

type ScanRequest = Omit<PermissionV1.Request, "id" | "sessionID" | "tool">

async function scan(dir: string, command: string, shell: string) {
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
        yield* permission.ask(ctx, { command, cwd: dir, shell, description: "test" })
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
})
