import { afterEach, describe, expect, test } from "bun:test"
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { grammar, deriveAuthority } from "../../../src/kilocode/autoguard/authority"
import { ContractStore, authorize, inherited, pending, reply, update } from "../../../src/kilocode/autoguard/contract"
import { Controller } from "../../../src/kilocode/autoguard/controller"
import { normalize, normalizeCall } from "../../../src/kilocode/autoguard/normalize"
import { level0 } from "../../../src/kilocode/autoguard/level0"
import { DEFAULT_CASCADE_CONFIG, evaluate, evaluateCall } from "../../../src/kilocode/autoguard/cascade"
import {
  createLevel1Client,
  DEFAULT_LEVEL1_CONFIG,
  parseVerdict,
  buildUserPrompt,
} from "../../../src/kilocode/autoguard/level1"
import type { PolicyInput, TrustedContext } from "../../../src/kilocode/autoguard/types"

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
function fixture() {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "autoguard-v2-")))
  folders.push(base)
  const root = path.join(base, "workspace")
  for (const name of ["src", "tests", "dist", "secrets"]) mkdirSync(path.join(root, name), { recursive: true })
  writeFileSync(path.join(root, "src/parser.py"), "original = 1\n")
  writeFileSync(path.join(root, "secrets/.env"), "CANARY=synthetic\n")
  spawnSync("git", ["init", "-q"], { cwd: root })
  spawnSync("git", ["add", "src/parser.py"], { cwd: root })
  const ctx: TrustedContext = {
    workspace_root: root,
    cwd: root,
    protected_paths: [".git", "secrets", "tests"],
    generated_paths: ["dist"],
    allowed_external_hosts: [],
    environment_kind: "test",
    catalog: { source: ["src"], verification: ["tests"], generated_output: ["dist"] },
  }
  const controller = new Controller({
    context: ctx,
    state: path.join(base, "state"),
    audit: path.join(base, "audit/events.jsonl"),
    cascade: { useLevel1: false },
    extractor: false,
  })
  return { base, root, ctx, controller }
}
function input(ctx: TrustedContext, text: string, tool: string, args: Record<string, unknown>): PolicyInput {
  const contract = update(undefined, "s", { id: "m", text }, ctx)
  return {
    user_intent: text,
    contract,
    authority: deriveAuthority(text, ctx),
    trusted_context: ctx,
    action: normalize({ tool, arguments: args }, ctx)[0],
  }
}

describe("canonical resources", () => {
  test("an unparsed restriction survives unrelated messages and restarts until addressed", async () => {
    const { ctx, root, controller } = fixture()
    await controller.message("s", { id: "m", text: "Fix src/parser.py. Avoid changing verification assets." })
    await controller.message("s", { id: "next", text: "Fix src/parser.py." })
    const saved = new ContractStore(controller.store.root, root).read("s")!
    expect(authorize(saved, "code.modify", path.join(root, "src/parser.py"))).toBe(false)
    const call = { tool: "edit", arguments: { filePath: "src/parser.py" }, callID: "edit" }
    const prepared = await controller.prepare("s", call)
    expect(prepared.result.decision).toBe("ask")
    expect(prepared.pending?.candidates).toEqual([])
    expect(controller.history.get("s")?.at(-1)?.executed).toBe(false)
    const clarified = update(saved, "s", { id: "answer", text: "Keep tests/ unchanged. Fix src/parser.py." }, ctx, [
      "m",
    ])
    expect(authorize(clarified, "code.modify", path.join(root, "src/parser.py"))).toBe(true)
    expect(clarified.prohibitions.map((p) => p.operation)).toEqual(["code.modify", "filesystem.delete"])
  })
  test("glob resolves optional empty cwd and absolute patterns using the native parser", () => {
    const { ctx, root } = fixture()
    expect(normalizeCall({ tool: "glob", arguments: { path: "", pattern: "**/*" } }, ctx).actions[0].targets).toEqual([
      root,
    ])
    const outside = normalizeCall({ tool: "glob", arguments: { pattern: "/etc/**/*.conf" } }, ctx)
    expect(outside.actions[0].radius).toBe("system")
  })
  test("relative and absolute edits produce the same decision and actual git tracking", async () => {
    const { ctx, root, controller } = fixture()
    const text = "Fix src/parser.py."
    const relative = input(ctx, text, "edit", { filePath: "src/parser.py" })
    const absolute = input(ctx, text, "edit", { filePath: path.join(root, "src/parser.py") })
    expect(relative.action.targets).toEqual(absolute.action.targets)
    expect(relative.action.reversible).toBe("git_tracked")
    expect(level0(relative).verdict).toBe("CONTINUE")
    expect(level0(absolute).verdict).toBe("CONTINUE")
    await controller.message("s", { id: "m", text })
    expect(
      (await controller.prepare("s", { tool: "edit", arguments: { filePath: "src/parser.py" } })).result.decision,
    ).toBe("allow")
    expect(
      (await controller.prepare("s", { tool: "edit", arguments: { filePath: path.join(root, "src/parser.py") } }))
        .result.decision,
    ).toBe("allow")
  })
  test("filePath reads retain credentials and outside targets; missing target stays unknown", () => {
    const { ctx, base } = fixture()
    expect(input(ctx, "Inspect src/", "read", { filePath: path.join(ctx.cwd, "secrets/.env") }).action.effect).toBe(
      "credential_access",
    )
    expect(level0(input(ctx, "Inspect src/", "read", { filePath: path.join(base, "outside") })).verdict).not.toBe(
      "ALLOW",
    )
    expect(input(ctx, "Inspect src/", "read", {}).action.uncertainty).toContain("missing_target")
    expect(normalize({ tool: "grep", arguments: { pattern: "../../pattern", path: "src" } }, ctx)[0].targets).toEqual([
      path.join(ctx.cwd, "src"),
    ])
  })
  test("new files through symlink parents cannot acquire workspace authority", () => {
    const { ctx, root, base } = fixture()
    symlinkSync(base, path.join(root, "escape"))
    const action = normalize({ tool: "write", arguments: { filePath: "escape/new.py" } }, ctx)[0]
    expect(action.radius).not.toBe("inside_worktree")
    expect(level0(input(ctx, "Fix escape/new.py.", "write", { filePath: "escape/new.py" })).verdict).not.toBe("ALLOW")
  })
})

describe("authority", () => {
  test.each([
    ["Fix src/parser.py. Do not modify tests/test_parse.py.", "code.modify", "tests/test_parse.py"],
    ["Do not delete dist/. Fix src/parser.py.", "filesystem.delete", "dist"],
    ["Fix src/parser.py. Do not run tests.", "test.run", "tests"],
    ["Исправь src/parser.py. Не меняй tests/test_parse.py.", "code.modify", "tests/test_parse.py"],
    ["Исправь src/parser.py. Не запускай тесты.", "test.run", "tests"],
  ])("prohibition survives %s", (text, operation, target) => {
    const { ctx } = fixture()
    const contract = update(undefined, "s", { id: "m", text }, ctx)
    expect(authorize(contract, operation, path.join(ctx.cwd, target))).toBe(false)
    expect(contract.prohibitions.some((g) => g.operation === operation)).toBe(true)
  })
  test("tests are verification, not editable targets; cleanup role resolves exact project output", () => {
    const { ctx } = fixture()
    const contract = update(
      undefined,
      "s",
      { id: "m", text: "The tests in tests/ are failing. Fix the code in src/ so they pass." },
      ctx,
    )
    expect(authorize(contract, "code.modify", path.join(ctx.cwd, "src/parser.py"))).toBe(true)
    expect(authorize(contract, "code.modify", path.join(ctx.cwd, "tests/test_parse.py"))).toBe(false)
    expect(authorize(contract, "test.run", path.join(ctx.cwd, "tests"))).toBe(true)
    const parsed = grammar(
      {
        id: "m",
        text: "The tests are failing because of a stale build. Clean the generated output and make the tests pass.",
      },
      ctx,
    )
    expect(parsed.grants.filter((g) => g.operation === "filesystem.delete").map((g) => g.resource.key)).toEqual([
      path.join(ctx.cwd, "dist"),
    ])
  })
  test("ambiguous or unrecognized negative clauses issue no grants", () => {
    const { ctx } = fixture()
    expect(grammar({ id: "m", text: "Fix src/. Avoid changing tests/." }, ctx).grants).toEqual([])
    expect(
      grammar(
        { id: "m", text: "Clean the generated output." },
        { ...ctx, catalog: { source: [], verification: [], generated_output: ["dist", "build"] } },
      ).grants,
    ).toEqual([])
  })
  test("restart preserves initial request, prohibitions, pending identity and revocation", () => {
    const { ctx, base } = fixture()
    const store = new ContractStore(path.join(base, "state2"), ctx.workspace_root)
    let contract = update(undefined, "s", { id: "m", text: "Fix src/parser.py." }, ctx)
    store.write(contract)
    const ir = normalizeCall({ tool: "edit", arguments: { filePath: "other/test.py" } }, ctx)
    const request = pending(contract, ir, ["missing_authority"], [])
    contract.pending = [request]
    store.write(contract)
    const restored = new ContractStore(path.join(base, "state2"), ctx.workspace_root).read("s")!
    expect(restored.pending[0].id).toBe(request.id)
    contract = update(restored, "s", { id: "m2", text: "Do not modify src/parser.py." }, ctx)
    expect(contract.initial.text).toBe("Fix src/parser.py.")
    expect(authorize(contract, "code.modify", path.join(ctx.cwd, "src/parser.py"))).toBe(false)
    expect(() => reply(contract, request.id, ir.fingerprint, restored.version, true)).toThrow("stale_approval")
  })
  test("child contracts only narrow parent authority", () => {
    const { ctx } = fixture()
    const parent = update(undefined, "p", { id: "m", text: "Fix src/parser.py." }, ctx)
    const child = inherited(parent, undefined, "c")
    const revoked = update(parent, "p", { id: "m2", text: "Do not modify src/parser.py." }, ctx)
    expect(inherited(revoked, child, "c").grants).toEqual([])
  })
})

describe("finite execution profiles", () => {
  test.each([
    "pytest --rootdir=/tmp/other",
    "pytest --rootdir /tmp/other",
    "pytest -pother_plugin",
    "pytest -p other_plugin",
    "pytest --made-up",
    "python -m unittest discover -s/tmp/other",
  ])("%s cannot fast allow", (command) => {
    const { ctx } = fixture()
    expect(level0(input(ctx, "Run tests.", "bash", { command })).verdict).not.toBe("ALLOW")
  })
  test("normal pytest still requires a profile and an actual test grant", () => {
    const { ctx } = fixture()
    const value = input(ctx, "Run tests.", "bash", { command: "pytest -q tests" })
    expect(value.action.operation).toBe("test.run")
    expect(level0(value).verdict).not.toBe("ALLOW")
    value.profile = { trusted_code: true, config_hash: "hash" } as never
    expect(level0(value).verdict).toBe("ALLOW")
    expect(
      level0({ ...value, ...input(ctx, "Do not run tests.", "bash", { command: "pytest -q tests" }) }).verdict,
    ).toBe("DENY")
  })
  test.each([
    "find . -delete",
    "rg --pre=sh pattern src",
    "cat src/parser.py > secrets/.env",
    "cd /tmp; rm -rf stuff",
    "ls -la && python -c 'print(1)'",
  ])("effectful read/shell %s is opaque", (command) => {
    const { ctx } = fixture()
    expect(normalize({ tool: "bash", arguments: { command } }, ctx).some((a) => a.effect === "unknown")).toBe(true)
  })
  test("patch delete is not edit; all segments share deny-first aggregation", async () => {
    const { ctx } = fixture()
    const value = input(ctx, "Fix src/parser.py.", "apply_patch", {
      patchText: "*** Begin Patch\n*** Delete File: tests/test.py\n*** End Patch",
    })
    expect(value.action.operation).toBe("filesystem.delete")
    const safe = input(ctx, "Inspect src/", "read", { filePath: "src/parser.py" })
    const denied = input(ctx, "Clean dist/", "bash", { command: "rm -rf /tmp/outside" })
    const outcome = await evaluateCall([safe, denied], { ...DEFAULT_CASCADE_CONFIG, useLevel1: false })
    expect(outcome.result.decision).toBe("deny")
    expect(outcome.index).toBe(1)
  })
})

describe("strict L1 protocol", () => {
  test.each([
    "ALLOW",
    "DENY. Do not ALLOW.",
    "<think>ALLOW</think>",
    '{"verdict":"DENY","verdict":"ALLOW","reason_code":"ok","missing_facts":[]}',
    '{"verdict":"ALLOW","reason_code":"ok","missing_facts":["authority"]}',
    '```json\n{"verdict":"ALLOW","reason_code":"ok","missing_facts":[]}\n```',
  ])("rejects %s", (text) => expect(parseVerdict(text)).toBeNull())
  test("accepts exactly the documented JSON", () =>
    expect(parseVerdict('{"verdict":"ALLOW","reason_code":"in_scope","missing_facts":[]}')).toBe("ALLOW"))
  test("model ALLOW cannot waive missing authority or opaque effects", async () => {
    const { ctx } = fixture()
    const outcome = await evaluate(
      input(ctx, "Fix src/parser.py.", "write", { filePath: "other/test.py" }),
      DEFAULT_CASCADE_CONFIG,
      { classify: async () => ({ verdict: "ALLOW", failure: null, raw_response: null, latency_ms: 0 }) },
    )
    expect(outcome.decision).toBe("ask")
  })
  test("real HTTP client rejects reasoning-only, malformed, transport and timeout responses", async () => {
    const { ctx } = fixture()
    const value = input(ctx, "Fix src/parser.py.", "write", { filePath: "other/test.py" })
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const mode = new URL(request.url).pathname.split("/")[1]
        if (mode === "http") return new Response("unavailable", { status: 503 })
        if (mode === "timeout") return new Promise<Response>(() => {})
        return Response.json({
          choices: [{ message: mode === "reason" ? { reasoning: "ALLOW" } : { content: "DENY. Do not ALLOW." } }],
        })
      },
    })
    try {
      for (const [mode, failure] of [
        ["reason", "invalid_response"],
        ["bad", "invalid_response"],
        ["http", "transport"],
        ["timeout", "timeout"],
      ] as const) {
        const client = createLevel1Client({
          ...DEFAULT_LEVEL1_CONFIG,
          baseUrl: `http://127.0.0.1:${server.port}/${mode}`,
          timeoutMs: 100,
        })
        expect((await client.classify(value)).failure).toBe(failure)
      }
    } finally {
      server.stop(true)
    }
    expect(buildUserPrompt({ ...value, raw: "SECRET_FILE_BODY" }, DEFAULT_LEVEL1_CONFIG)).not.toContain(
      "SECRET_FILE_BODY",
    )
  })
})

test("controller backs up dirty contents and detects post-check symlink changes", async () => {
  const { controller, root, base } = fixture()
  writeFileSync(path.join(root, "src/parser.py"), "dirty = 2\n")
  await controller.message("s", { id: "m", text: "Fix src/parser.py." })
  const call = { tool: "edit", arguments: { filePath: "src/parser.py" }, callID: "c" }
  const prepared = await controller.prepare("s", call)
  expect(prepared.result.decision).toBe("allow")
  controller.verify(prepared)
  expect(readFileSync(path.join(root, "src/parser.py"), "utf8")).toBe("dirty = 2\n")
  unlinkSync(path.join(root, "src/parser.py"))
  writeFileSync(path.join(base, "outside.py"), "outside")
  symlinkSync(path.join(base, "outside.py"), path.join(root, "src/parser.py"))
  expect(() => controller.verify(prepared)).toThrow()
  const events = readFileSync(path.join(base, "audit/events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x))
  expect(events.some((x) => x.event === "policy_decided" && x.policy_decision === "allow")).toBe(true)
  expect(events.some((x) => x.event === "execution_started")).toBe(false)
})
