import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { buildTargets, decide, guardedExecute, WRITE_TOOLS, enabled, type WriteGateDeps } from "../../src/kilocode/gate/write-gate"
import type { Verdict, WriteJudgeInput } from "../../src/kilocode/gate/action-judge"

const CWD = "/work/project"
const noExist = (_: string) => false
const allExist = (_: string) => true

describe("WriteGate — routing + flag", () => {
  test("gates only edit/write/apply_patch (not reads/shell)", () => {
    for (const t of ["edit", "write", "apply_patch"]) expect(WRITE_TOOLS.has(t)).toBe(true)
    for (const t of ["read", "ls", "grep", "bash", "shell", "kilo_memory_recall"]) expect(WRITE_TOOLS.has(t)).toBe(false)
  })
  test("feature flag is OFF by default", () => {
    expect(enabled).toBe(false)
  })
})

describe("WriteGate.buildTargets — op normalization (create/replace/overwrite/delete), targets only", () => {
  test("edit: empty oldString -> create; non-empty -> replace", () => {
    expect(buildTargets("edit", { filePath: "src/a.ts", oldString: "", newString: "y" }, CWD, noExist)).toEqual([
      { path: "/work/project/src/a.ts", op: "create" },
    ])
    expect(buildTargets("edit", { filePath: "src/a.ts", oldString: "x", newString: "y" }, CWD, allExist)).toEqual([
      { path: "/work/project/src/a.ts", op: "replace" },
    ])
  })
  test("write: existing -> overwrite; missing -> create", () => {
    expect(buildTargets("write", { filePath: "a", content: "X" }, CWD, allExist)).toEqual([{ path: "/work/project/a", op: "overwrite" }])
    expect(buildTargets("write", { filePath: "a", content: "X" }, CWD, noExist)).toEqual([{ path: "/work/project/a", op: "create" }])
  })
  test("apply_patch: Add clobbers existing (overwrite); Delete; Move -> delete source + create/overwrite dest", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: dir/new.txt",
      "+hello",
      "*** Delete File: gone.txt",
      "*** Update File: a.txt",
      "*** Move to: b.txt",
      "@@",
      "-old",
      "+new",
      "*** End Patch",
    ].join("\n")
    // dir/new.txt exists -> Add is an overwrite; move destination b.txt exists -> overwrite
    const exists = (p: string) => p.endsWith("/dir/new.txt") || p.endsWith("/b.txt")
    const t = buildTargets("apply_patch", { patchText: patch }, CWD, exists)
    expect(t).toContainEqual({ path: "/work/project/dir/new.txt", op: "overwrite" })
    expect(t).toContainEqual({ path: "/work/project/gone.txt", op: "delete" })
    expect(t).toContainEqual({ path: "/work/project/a.txt", op: "delete" }) // move source removed
    expect(t).toContainEqual({ path: "/work/project/b.txt", op: "overwrite" }) // move dest overwrites
    // if the move destination did NOT exist, it is a create (destination-overwrite risk exposed either way)
    const t2 = buildTargets("apply_patch", { patchText: patch }, CWD, noExist)
    expect(t2).toContainEqual({ path: "/work/project/dir/new.txt", op: "create" })
    expect(t2).toContainEqual({ path: "/work/project/b.txt", op: "create" })
    expect(JSON.stringify(t).includes("hello")).toBe(false) // no content leaked
  })
  test("unparseable patch throws so the caller fails closed", () => {
    expect(() => buildTargets("apply_patch", { patchText: "garbage without markers" }, CWD, noExist)).toThrow()
  })
})

describe("WriteGate.decide / guardedExecute — behavioral (fake judge + execute callback)", () => {
  const mkDeps = (over: Partial<WriteGateDeps>, judge: WriteGateDeps["judge"]): WriteGateDeps => ({
    tool: "write",
    isChildSession: false,
    args: { filePath: "notes.txt", content: "hi" },
    cwd: CWD,
    exists: noExist,
    intent: "create notes.txt",
    judge,
    ...over,
  })
  const allowJudge = () => Effect.succeed<Verdict>({ decision: "allow", reasonCode: "matches_intent" })
  const blockJudge = () => Effect.succeed<Verdict>({ decision: "block", reasonCode: "off_intent" })
  const run = <A>(e: Effect.Effect<A>) => Effect.runPromise(e)
  const runExit = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromiseExit(e)

  test("child-session -> block; judge NOT called, execute NOT called", async () => {
    let judged = 0
    let ran = 0
    const deps = mkDeps({ isChildSession: true }, () => {
      judged++
      return allowJudge()
    })
    const exit = await runExit(guardedExecute(deps, () => Effect.sync(() => { ran++; return "OK" })))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(judged).toBe(0)
    expect(ran).toBe(0)
    const v = await run(decide(deps))
    expect(v).toEqual({ decision: "block", reasonCode: "unverified_child_intent" })
  })
  test("missing intent -> block; judge NOT called", async () => {
    let judged = 0
    const deps = mkDeps({ intent: undefined }, () => {
      judged++
      return allowJudge()
    })
    expect(await run(decide(deps))).toEqual({ decision: "block", reasonCode: "intent_missing" })
    expect(judged).toBe(0)
  })
  test("invalid patch -> block(patch_parse_error); judge NOT called", async () => {
    let judged = 0
    const deps = mkDeps({ tool: "apply_patch", args: { patchText: "garbage" } }, () => {
      judged++
      return allowJudge()
    })
    expect(await run(decide(deps))).toEqual({ decision: "block", reasonCode: "patch_parse_error" })
    expect(judged).toBe(0)
  })
  test("verdict allow -> execute called EXACTLY once", async () => {
    let ran = 0
    const out = await run(guardedExecute(mkDeps({}, allowJudge), () => Effect.sync(() => { ran++; return "OK" })))
    expect(out).toBe("OK")
    expect(ran).toBe(1)
  })
  test("verdict block -> execute NOT called", async () => {
    let ran = 0
    const exit = await runExit(guardedExecute(mkDeps({}, blockJudge), () => Effect.sync(() => { ran++; return "OK" })))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(ran).toBe(0)
  })
  test("abort inside judge propagates as interruption; execute NOT called", async () => {
    let ran = 0
    const abortJudge = () => Effect.interrupt as unknown as Effect.Effect<Verdict>
    const exit = await runExit(guardedExecute(mkDeps({}, abortJudge), () => Effect.sync(() => { ran++; return "OK" })))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(ran).toBe(0)
  })
  test("classifier payload carries NO file content — only targets(path+op)", async () => {
    let seen: WriteJudgeInput | undefined
    const deps = mkDeps({ tool: "write", args: { filePath: "a", content: "SECRET-CANARY" } }, (i) => {
      seen = i
      return allowJudge()
    })
    await run(guardedExecute(deps, () => Effect.succeed("OK")))
    expect(JSON.stringify(seen).includes("SECRET-CANARY")).toBe(false)
    expect(seen?.targets).toEqual([{ path: "/work/project/a", op: "create" }])
  })
  test("apply_patch: ALL targets in ONE atomic judge decision before any side effect", async () => {
    let calls = 0
    let seen: WriteJudgeInput | undefined
    const patch = ["*** Begin Patch", "*** Add File: x.txt", "+hi", "*** Delete File: y.txt", "*** End Patch"].join("\n")
    const deps = mkDeps({ tool: "apply_patch", args: { patchText: patch } }, (i) => {
      calls++
      seen = i
      return allowJudge()
    })
    let ran = 0
    await run(guardedExecute(deps, () => Effect.sync(() => { ran++; return "OK" })))
    expect(calls).toBe(1) // single decision over all hunks
    expect(seen?.targets).toEqual([
      { path: "/work/project/x.txt", op: "create" },
      { path: "/work/project/y.txt", op: "delete" },
    ])
    expect(ran).toBe(1)
  })
})
