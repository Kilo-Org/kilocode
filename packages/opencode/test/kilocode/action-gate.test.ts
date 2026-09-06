import { describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { analyzeRm, checkDestructiveRm, isCriticalPath, isRmInvocation, type RmTarget } from "../../src/kilocode/gate/action-gate"

const CWD = "/work/project"

// NOTE: this is a STAND-IN resolver, NOT the real ShellTool.argPath / tree-sitter path. It mirrors
// argPath's shape (strip quotes; $VAR/glob -> undefined; else resolve against cwd) so we can unit-test
// the analyzeRm + checkDestructiveRm decision logic deterministically. The REAL parser + resolver are
// verified separately by artifacts/coverage-runs/tripwire-parser-verify.mjs and the live E2E runs; the
// feature-flag-off path is verified by the harness A/B suite (gate off -> command EXECUTED).
function resolveArg(token: string, cwd = CWD): string | undefined {
  let t = token
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1)
  if (t.includes("$") || t.includes("*") || t.includes("?")) return undefined
  return path.resolve(cwd, t)
}

// Full chain a destructive-rm command goes through in shell.ts: tokens -> analyzeRm -> resolve -> verdict.
function evaluate(tokens: string[], cwd = CWD, instanceDir = CWD) {
  const rm = analyzeRm(tokens)
  if (!rm.destructive) return { block: false as const, rm }
  const targets: RmTarget[] = rm.paths.map((raw) => ({ raw, resolved: resolveArg(raw, cwd) }))
  return { ...checkDestructiveRm(targets, cwd, instanceDir), rm }
}

describe("ActionGate.analyzeRm — token recognition", () => {
  test("plain rm and absolute-path rm are both recognized", () => {
    expect(isRmInvocation("rm")).toBe(true)
    expect(isRmInvocation("/bin/rm")).toBe(true)
    expect(isRmInvocation("/usr/bin/rm")).toBe(true)
    expect(isRmInvocation("rmdir")).toBe(false)
  })
  test("combined, separate, and long recursive+force flags", () => {
    expect(analyzeRm(["rm", "-rf", "x"]).destructive).toBe(true)
    expect(analyzeRm(["rm", "-fr", "x"]).destructive).toBe(true)
    expect(analyzeRm(["rm", "-r", "-f", "x"]).destructive).toBe(true)
    expect(analyzeRm(["rm", "-R", "-f", "x"]).destructive).toBe(true)
    expect(analyzeRm(["rm", "--recursive", "--force", "x"]).destructive).toBe(true)
    expect(analyzeRm(["rm", "-r", "x"]).destructive).toBe(false) // force missing
    expect(analyzeRm(["rm", "-f", "x"]).destructive).toBe(false) // recursive missing
  })
  test("-- ends flag parsing; the rest are paths", () => {
    const rm = analyzeRm(["rm", "--recursive", "--force", "--", "build"])
    expect(rm.destructive).toBe(true)
    expect(rm.paths).toEqual(["build"])
  })
})

describe("ActionGate — token-level evaluation with a stand-in resolver (Codex cases; NOT real ShellPermission)", () => {
  test("rm -rf . -> block (cwd is critical)", () => {
    expect(evaluate(["rm", "-rf", "."]).block).toBe(true)
  })
  test("/bin/rm -rf . -> block (absolute path invocation)", () => {
    expect(evaluate(["/bin/rm", "-rf", "."]).block).toBe(true)
  })
  test('rm -rf "$HOME" -> block (dynamic target, fail closed)', () => {
    expect(evaluate(["rm", "-rf", '"$HOME"']).block).toBe(true)
  })
  test('rm -rf "$PWD" -> block (dynamic target, fail closed)', () => {
    expect(evaluate(["rm", "-rf", '"$PWD"']).block).toBe(true)
  })
  test("rm -fr .. -> block (parent of workspace)", () => {
    expect(evaluate(["rm", "-fr", ".."]).block).toBe(true)
  })
  test("rm --recursive --force -- build -> allow (subdir)", () => {
    expect(evaluate(["rm", "--recursive", "--force", "--", "build"]).block).toBe(false)
  })
  test("rm -rf build/ -> allow (subdir)", () => {
    expect(evaluate(["rm", "-rf", "build/"]).block).toBe(false)
  })
  test("non-destructive rm is not evaluated (feature acts only on rm -rf)", () => {
    expect(evaluate(["rm", "stale.tmp"]).block).toBe(false)
    expect(evaluate(["rm", "-f", "stale.tmp"]).block).toBe(false)
  })
})

describe("ActionGate.checkDestructiveRm — critical paths and fail-closed", () => {
  test("blocks filesystem root, top-level, home", () => {
    expect(checkDestructiveRm([{ raw: "/", resolved: "/" }], CWD, CWD).block).toBe(true)
    expect(checkDestructiveRm([{ raw: "/usr", resolved: "/usr" }], CWD, CWD).block).toBe(true)
    expect(checkDestructiveRm([{ raw: "~", resolved: path.resolve(os.homedir()) }], CWD, CWD).block).toBe(true)
  })
  test("unresolved target fails closed", () => {
    expect(checkDestructiveRm([{ raw: "$HOME", resolved: undefined }], CWD, CWD).block).toBe(true)
  })
  test("blocks when one of several targets is critical, allows all-safe", () => {
    expect(
      checkDestructiveRm([{ raw: "build", resolved: `${CWD}/build` }, { raw: "..", resolved: "/work" }], CWD, CWD).block,
    ).toBe(true)
    expect(
      checkDestructiveRm([{ raw: "build", resolved: `${CWD}/build` }, { raw: "dist", resolved: `${CWD}/dist` }], CWD, CWD)
        .block,
    ).toBe(false)
  })
  test("simple command wrappers are peeled: sudo/command/env rm -rf ... -> block", () => {
    expect(evaluate(["sudo", "rm", "-rf", "/"]).block).toBe(true)
    expect(evaluate(["command", "rm", "-rf", "/"]).block).toBe(true)
    expect(evaluate(["env", "rm", "-rf", "/"]).block).toBe(true)
    expect(evaluate(["env", "FOO=bar", "rm", "-rf", "/"]).block).toBe(true)
    // wrapper in front of an absolute-path rm is still caught
    expect(evaluate(["sudo", "/bin/rm", "-rf", "."]).block).toBe(true)
  })

  test("wrapper negatives must NOT block", () => {
    // env runs echo, not rm -> not a destructive rm
    expect(evaluate(["env", "echo", "rm", "-rf", "/"]).block).toBe(false)
    // `command -v rm` is a lookup of rm, not an invocation of it
    expect(evaluate(["command", "-v", "rm"]).block).toBe(false)
    // env with its own option is a complex form we intentionally do NOT peel (documented limitation)
    expect(analyzeRm(["env", "-i", "rm", "-rf", "/"]).destructive).toBe(false)
    // sudo with its own option is likewise left as a documented limitation
    expect(analyzeRm(["sudo", "-u", "root", "rm", "-rf", "/"]).destructive).toBe(false)
  })

  test("ancestor check does not misread a sibling like ..project", () => {
    // base /work/project is INSIDE /work/..project? No — they are different dirs; deleting one must not flag the other.
    expect(isCriticalPath("/work/siblingdir", CWD, CWD)).toBe(false)
    // a real forward child named oddly is still not the cwd/parent
    expect(isCriticalPath(`${CWD}/..data`, CWD, CWD)).toBe(false)
  })
})
