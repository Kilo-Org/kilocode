import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { buildTargets, decide, WRITE_TOOLS, enabled, type WriteGateDeps } from "../../src/kilocode/gate/write-gate"
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
  test("a non-string filePath is NOT coerced to an [object Object] string (regression: str() drops non-strings)", () => {
    const [t] = buildTargets("edit", { filePath: { evil: true }, oldString: "x", newString: "y" }, CWD, noExist)
    expect(t!.path).toBe(CWD) // empty string resolves to cwd, never .../[object Object]
    expect(t!.path.includes("[object Object]")).toBe(false)
  })
})

describe("WriteGate.decide — verdict routing (fake judge; surface applies allow/block/ask)", () => {
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
  const askJudge = () => Effect.succeed<Verdict>({ decision: "ask", reasonCode: "classifier_timeout" })
  const run = <A>(e: Effect.Effect<A>) => Effect.runPromise(e)
  const runExit = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromiseExit(e)

  test("child-session -> block(unverified_child_intent); judge NOT called", async () => {
    let judged = 0
    const v = await run(decide(mkDeps({ isChildSession: true }, () => { judged++; return allowJudge() })))
    expect(v).toEqual({ decision: "block", reasonCode: "unverified_child_intent" })
    expect(judged).toBe(0)
  })
  test("missing intent -> block(intent_missing); judge NOT called", async () => {
    let judged = 0
    expect(await run(decide(mkDeps({ intent: undefined }, () => { judged++; return allowJudge() })))).toEqual({ decision: "block", reasonCode: "intent_missing" })
    expect(judged).toBe(0)
  })
  test("invalid patch -> block(patch_parse_error); judge NOT called", async () => {
    let judged = 0
    expect(await run(decide(mkDeps({ tool: "apply_patch", args: { patchText: "garbage" } }, () => { judged++; return allowJudge() })))).toEqual({ decision: "block", reasonCode: "patch_parse_error" })
    expect(judged).toBe(0)
  })
  test("judge allow -> allow", async () => {
    expect(await run(decide(mkDeps({}, allowJudge)))).toEqual({ decision: "allow", reasonCode: "matches_intent" })
  })
  test("judge block -> block(off_intent)", async () => {
    expect(await run(decide(mkDeps({}, blockJudge)))).toEqual({ decision: "block", reasonCode: "off_intent" })
  })
  test("judge ask (classifier infra failure) -> ask(classifier_timeout) [surface will escalate to a prompt]", async () => {
    expect(await run(decide(mkDeps({}, askJudge)))).toEqual({ decision: "ask", reasonCode: "classifier_timeout" })
  })
  test("abort inside judge -> interruption propagates", async () => {
    const abortJudge = () => Effect.interrupt as unknown as Effect.Effect<Verdict>
    expect(Exit.isFailure(await runExit(decide(mkDeps({}, abortJudge))))).toBe(true)
  })
  test("classifier payload carries NO file content — only targets(path+op)", async () => {
    let seen: WriteJudgeInput | undefined
    await run(decide(mkDeps({ tool: "write", args: { filePath: "a", content: "SECRET-CANARY" } }, (i) => { seen = i; return allowJudge() })))
    expect(JSON.stringify(seen).includes("SECRET-CANARY")).toBe(false)
    expect(seen?.targets).toEqual([{ path: "/work/project/a", op: "create" }])
  })
  test("apply_patch: ALL targets in ONE atomic decision", async () => {
    let calls = 0
    let seen: WriteJudgeInput | undefined
    const patch = ["*** Begin Patch", "*** Add File: x.txt", "+hi", "*** Delete File: y.txt", "*** End Patch"].join("\n")
    await run(decide(mkDeps({ tool: "apply_patch", args: { patchText: patch } }, (i) => { calls++; seen = i; return allowJudge() })))
    expect(calls).toBe(1)
    expect(seen?.targets).toEqual([
      { path: "/work/project/x.txt", op: "create" },
      { path: "/work/project/y.txt", op: "delete" },
    ])
  })
})
