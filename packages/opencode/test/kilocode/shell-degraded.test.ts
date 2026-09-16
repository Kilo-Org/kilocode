import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ask } from "../../src/tool/shell"
import type { Context } from "../../src/tool/tool"
import { ACTION_GATE_DEGRADED_KEY, ACTION_GATE_AUTHORIZED_KEY } from "../../src/kilocode/permission/interactive-approval"

type AnyReq = Parameters<Context["ask"]>[0]
const recCtx = (log: AnyReq[]) => ({ ask: (req: AnyReq) => { log.push(req); return Effect.succeed(undefined) } }) as unknown as Context
const md = (r: AnyReq) => r.metadata as Record<string, unknown>

describe("shell ask() — degraded tags ONLY the bash action ask, not external_directory", () => {
  test("degraded: external_directory untouched; bash ask tagged with always:[]", async () => {
    const log: AnyReq[] = []
    const scan = { dirs: new Set(["/w/dir"]), patterns: new Set(["ls"]), always: new Set(["ls"]), access: "write" } as never
    await Effect.runPromise(ask(recCtx(log), scan, "ls", {} as never, undefined, "classifier_timeout"))
    const ext = log.find((r) => r.permission === "external_directory")!
    const bash = log.find((r) => r.permission !== "external_directory")!
    expect(md(ext)[ACTION_GATE_DEGRADED_KEY]).toBeUndefined() // auxiliary ask NOT tagged
    expect(ext.always.length).toBeGreaterThan(0) // and keeps its always list
    expect(md(bash)[ACTION_GATE_DEGRADED_KEY]).toBe(true) // action-level bash ask IS the degraded prompt
    expect(bash.always).toEqual([]) // one-shot: no persisted rule
  })
  test("NOT degraded: bash ask carries no degraded tag and keeps its always", async () => {
    const log: AnyReq[] = []
    const scan = { dirs: new Set<string>(), patterns: new Set(["ls"]), always: new Set(["ls"]), access: "write" } as never
    await Effect.runPromise(ask(recCtx(log), scan, "ls", {} as never, undefined, undefined))
    expect(md(log[0]!)[ACTION_GATE_DEGRADED_KEY]).toBeUndefined()
    expect(log[0]!.always).toEqual(["ls"])
  })
})

describe("shell ask() — one-shot pre-approval marks ONLY the bash action ask, not external_directory", () => {
  test("authorized: external_directory untouched; bash ask marked with always:[] and NOT degraded", async () => {
    const log: AnyReq[] = []
    const scan = { dirs: new Set(["/w/dir"]), patterns: new Set(["ls"]), always: new Set(["ls"]), access: "write" } as never
    // degraded=undefined, authorized=true
    await Effect.runPromise(ask(recCtx(log), scan, "ls", {} as never, undefined, undefined, true))
    const ext = log.find((r) => r.permission === "external_directory")!
    const bash = log.find((r) => r.permission !== "external_directory")!
    expect(md(ext)[ACTION_GATE_AUTHORIZED_KEY]).toBeUndefined() // auxiliary ask NOT pre-approved
    expect(ext.always.length).toBeGreaterThan(0) // and keeps its always list
    expect(md(bash)[ACTION_GATE_AUTHORIZED_KEY]).toBe(true) // bash action ask IS pre-approved
    expect(md(bash)[ACTION_GATE_DEGRADED_KEY]).toBeUndefined() // never conflated with a degraded escalation
    expect(bash.always).toEqual([]) // one-shot: no persisted rule
  })
  test("NOT authorized: bash ask carries no pre-approval marker and keeps its always", async () => {
    const log: AnyReq[] = []
    const scan = { dirs: new Set<string>(), patterns: new Set(["ls"]), always: new Set(["ls"]), access: "write" } as never
    await Effect.runPromise(ask(recCtx(log), scan, "ls", {} as never, undefined, undefined, false))
    expect(md(log[0]!)[ACTION_GATE_AUTHORIZED_KEY]).toBeUndefined()
    expect(log[0]!.always).toEqual(["ls"])
  })
})
