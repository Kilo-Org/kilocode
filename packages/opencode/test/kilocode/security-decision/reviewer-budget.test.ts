// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SecurityDecisionAdapter } from "@/kilocode/security-decision/adapter"
import { SecurityReviewer } from "@/kilocode/security-decision/reviewer"
import { SecurityDecisionRules as R } from "@/kilocode/security-decision/rules"
import type { SecurityDecisionTypes as T } from "@/kilocode/security-decision/types"

/**
 * What the reviewer is allowed to see less of.
 *
 * A bounded request is not the same thing as a *partial* one. The evidence a verdict rests on —
 * which program runs, with which arguments, over which classified targets, under which confinement
 * — has to arrive whole or not at all: a reviewer that allows an action after seeing a prefix of it
 * has allowed something it never saw. Everything else the request carries is context for judging
 * fit, and context may be shortened as long as the shortening is declared.
 *
 * So these tests are in two halves. The first half pins the invariant and must keep passing
 * whatever the budget does. The second half is the autonomy the budget buys back.
 */

const CONTAINMENT: T.Containment = { sandbox: "operational", network: "deny", destinations: [], escalated: false }

const base = {
  rule_id: "SEC.V1.CONTAINED_EXEC",
  kind: "bash",
  operation: "exec",
  containment: CONTAINMENT,
}

const path = (over: Partial<T.PathFact> = {}): T.PathFact => ({
  path: "src/a.ts",
  inWorkspace: true,
  class: "ordinary",
  ...over,
})

/** Every argv token an emitted request carries, across the single command and any sequence. */
function tokens(request: SecurityReviewer.Request): string[] {
  return [...request.action.argv, ...(request.action.commands ?? []).flatMap((command) => command.argv)]
}

describe("decision-critical evidence arrives whole or not at all", () => {
  test("an argv that cannot fit is refused rather than shortened", () => {
    const argv = ["node", "-e", "x".repeat(64_000)]
    const out = SecurityReviewer.request({ ...base, executable: "node", argv, paths: [] })
    expect(out.truncated).toBe(true)
    expect(out.request).toBeUndefined()
  })

  test("an emitted request never carries a shortened argument", () => {
    const argv = ["tsc", "--project", `packages/${"deep/".repeat(40)}tsconfig.json`]
    const out = SecurityReviewer.request({ ...base, executable: "tsc", argv, paths: [] })
    if (out.request) expect(tokens(out.request)).toEqual(argv)
  })

  test("an emitted request never drops an argument", () => {
    const argv = ["rm", "-rf", ...Array.from({ length: 60 }, (_, index) => `build/out-${index}.js`)]
    const out = SecurityReviewer.request({ ...base, executable: "rm", argv, paths: [] })
    if (out.request) expect(out.request.action.argv.length).toBe(argv.length)
  })

  test("an emitted request never drops a command of a sequence", () => {
    const commands = Array.from({ length: 24 }, (_, index) => ({
      executable: "echo",
      argv: ["echo", `step-${index}`],
    }))
    const out = SecurityReviewer.request({ ...base, commands, paths: [] })
    if (out.request) expect(out.request.action.commands?.length).toBe(commands.length)
  })

  test("an emitted request never drops a classified target", () => {
    const paths = Array.from({ length: 40 }, (_, index) => path({ path: `src/file-${index}.ts` }))
    const out = SecurityReviewer.request({ ...base, executable: "rm", argv: ["rm"], paths })
    if (out.request) expect(out.request.action.paths.length).toBe(paths.length)
  })

  test("an executable name is never shortened", () => {
    const executable = "a".repeat(4_000)
    const out = SecurityReviewer.request({ ...base, executable, argv: [executable], paths: [] })
    if (out.request) expect(out.request.action.executable).toBe(executable)
  })

  test("a target's class and scope survive whatever else is cut", () => {
    const out = SecurityReviewer.request({
      ...base,
      executable: "cat",
      argv: ["cat", "x"],
      paths: [path({ path: `src/${"nested/".repeat(60)}secrets.local.ts` })],
      task: "y".repeat(20_000),
    })
    expect(out.request?.action.paths[0]).toMatchObject({ class: "ordinary", inWorkspace: true })
  })

  test("a refused request is never handed to a bound model", async () => {
    let called = 0
    SecurityReviewer.bind(() => {
      called += 1
      return Promise.resolve('{"decision":"allow","reason_code":"OK"}')
    })
    const out = SecurityReviewer.request({ ...base, executable: "node", argv: ["node", "x".repeat(64_000)], paths: [] })
    expect(out.request).toBeUndefined()
    expect(called).toBe(0)
    SecurityReviewer.reset()
  })
})

describe("contextual evidence is shortened rather than thrown away", () => {
  test("an oversized task still reaches the reviewer", () => {
    const out = SecurityReviewer.request({
      ...base,
      executable: "npm",
      argv: ["npm", "test"],
      paths: [],
      task: "z".repeat(20_000),
    })
    expect(out.truncated).toBe(false)
    expect(out.request).toBeDefined()
    expect(out.request!.task!.length).toBeLessThan(20_000)
  })

  test("a long but ordinary argument no longer costs the reviewer the whole action", () => {
    // 128 characters is less than one deep monorepo path. Refusing the request over it removed the
    // reviewer from a large, entirely ordinary population.
    const argv = ["tsc", "--project", `packages/${"deep/".repeat(40)}tsconfig.json`]
    const out = SecurityReviewer.request({ ...base, executable: "tsc", argv, paths: [] })
    expect(out.truncated).toBe(false)
    expect(out.request).toBeDefined()
  })

  test("an ordinary number of arguments no longer costs the reviewer the whole action", () => {
    const argv = ["rm", "-rf", ...Array.from({ length: 60 }, (_, index) => `build/out-${index}.js`)]
    const out = SecurityReviewer.request({ ...base, executable: "rm", argv, paths: [] })
    expect(out.truncated).toBe(false)
    expect(out.request).toBeDefined()
  })

  test("an ordinary number of targets no longer costs the reviewer the whole action", () => {
    const paths = Array.from({ length: 40 }, (_, index) => path({ path: `src/file-${index}.ts` }))
    const out = SecurityReviewer.request({ ...base, executable: "rm", argv: ["rm"], paths })
    expect(out.truncated).toBe(false)
    expect(out.request).toBeDefined()
  })

  test("what was shortened is declared, with what it cost", () => {
    const out = SecurityReviewer.request({
      ...base,
      executable: "npm",
      argv: ["npm", "test"],
      paths: [],
      task: "z".repeat(20_000),
    })
    expect(out.request!.omitted).toEqual([{ field: "task", kept: expect.any(Number), original: 20_000 }])
    expect(out.request!.omitted![0]!.kept).toBeLessThan(20_000)
  })

  test("nothing is declared omitted when nothing was", () => {
    const out = SecurityReviewer.request({
      ...base,
      executable: "npm",
      argv: ["npm", "test"],
      paths: [],
      task: "run the unit tests",
    })
    expect(out.request!.omitted).toBeUndefined()
    expect(out.request!.task).toBe("run the unit tests")
  })

  test("a shortened string says so in the text the model reads", () => {
    const out = SecurityReviewer.request({
      ...base,
      executable: "npm",
      argv: ["npm", "test"],
      paths: [],
      task: `START${"z".repeat(20_000)}END`,
    })
    const task = out.request!.task!
    expect(task).toContain("truncated")
    // Head and tail both survive: the end of a path or a sentence carries as much as its start.
    expect(task.startsWith("START")).toBe(true)
    expect(task.endsWith("END")).toBe(true)
  })
})

describe("the emitted request stays inside its budget", () => {
  const size = (request: SecurityReviewer.Request) => Buffer.byteLength(JSON.stringify(request), "utf8")

  test("a request with one shortened field fits", () => {
    const out = SecurityReviewer.request({
      ...base,
      executable: "npm",
      argv: ["npm", "test"],
      paths: [],
      task: "z".repeat(50_000),
    })
    expect(size(out.request!)).toBeLessThanOrEqual(8_000)
  })

  test("a request with many shortened fields fits, declarations included", () => {
    // The `omitted` list is part of what gets sent, so it has to be inside the budget rather than
    // added on top of it once the fitting is done.
    const paths = Array.from({ length: 120 }, (_, index) =>
      path({ path: `src/${"nested/".repeat(30)}file-${index}.ts` }),
    )
    const out = SecurityReviewer.request({
      ...base,
      executable: "rm",
      argv: ["rm", "-rf"],
      paths,
      task: "z".repeat(50_000),
    })
    expect(out.request).toBeDefined()
    expect(size(out.request!)).toBeLessThanOrEqual(8_000)
  })
})

describe("the reviewer is told what omitted evidence means", () => {
  const prompt = () =>
    SecurityReviewer.prompt(
      SecurityReviewer.request({ ...base, executable: "npm", argv: ["npm", "test"], paths: [] }).request!,
    ).system

  test("omitted evidence is not benign", () => {
    expect(prompt().toLowerCase()).toContain("not assume")
  })

  test("missing context calls for more caution", () => {
    expect(prompt().toLowerCase()).toContain("cautious")
  })

  test("but truncation alone is not danger", () => {
    expect(prompt().toLowerCase()).toContain("does not by itself")
  })
})

describe("what the model actually receives", () => {
  test("the declaration and the inline marker both reach the prompt", async () => {
    const seen: string[] = []
    SecurityReviewer.bind((input) => {
      seen.push(input.user)
      return Promise.resolve('{"decision":"keep_ask","reason_code":"NEEDS_CONTEXT"}')
    })
    const prepared = SecurityReviewer.request({
      ...base,
      executable: "npm",
      argv: ["npm", "test"],
      paths: [],
      task: "z".repeat(20_000),
    })
    await Effect.runPromise(SecurityReviewer.review(R.result(R.DESTRUCTIVE_FS), prepared.request!, { timeout: 200 }))

    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('"omitted"')
    expect(seen[0]).toContain("truncated")
    expect(seen[0]).toContain('"original":20000')
    SecurityReviewer.reset()
  })

  test("a decision-critical overflow never becomes an allow, however willing the model is", async () => {
    SecurityReviewer.bind(() => Promise.resolve('{"decision":"allow","reason_code":"LOOKS_FINE"}'))
    const out = SecurityDecisionAdapter.evaluate(
      {
        permission: "bash",
        patterns: ["rm huge"],
        metadata: {
          securityFacts: {
            complete: true,
            composed: false,
            executable: "rm",
            argv: ["rm", ...Array.from({ length: 400 }, (_, index) => `argument-${index}`.padEnd(200, "x"))],
            classified: true,
            effects: [{ operation: "delete", path: "/repo/docs/old.md" }],
          },
        },
        sessionID: "ses_budget",
      },
      {
        workspace: "/repo",
        effective: "allow",
        humanOnly: false,
        floor: { action: "allow", authority: "untrusted", conflict: false },
        containment: CONTAINMENT,
      },
    )

    expect(out.decision).toBe("ask")
    expect(out.reviewable).toBe(false)
    expect(out.rule_id).toBe("SEC.V1.METADATA_INCOMPLETE")
    expect(out.review).toBeUndefined()
    SecurityReviewer.reset()
  })
})

describe("a bounded action still reaches a real verdict", () => {
  test("a request that was shortened can still be allowed", async () => {
    SecurityReviewer.bind(() => Promise.resolve('{"decision":"allow","reason_code":"ROUTINE_TEST_RUN"}'))
    const prepared = SecurityReviewer.request({
      ...base,
      executable: "npm",
      argv: ["npm", "test"],
      paths: [],
      task: "z".repeat(20_000),
    })
    expect(prepared.request).toBeDefined()
    const out = await Effect.runPromise(
      SecurityReviewer.review(R.result(R.DESTRUCTIVE_FS), prepared.request!, { timeout: 200 }),
    )
    expect(out.result.decision).toBe("allow")
    SecurityReviewer.reset()
  })
})
