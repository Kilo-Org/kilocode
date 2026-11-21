// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { SecurityDecisionAdapter } from "@/kilocode/security-decision/adapter"

/**
 * The layer's central claim is that it judges an action by what it does, not by how it is written.
 * That claim is only worth as much as the normalization behind it: every table in the policy matches
 * on a *token*, and a token the shell would have rewritten before the program ever saw it — a quoted
 * flag, an escaped one, a name in another case — is a different token to a `Set.has` and the same
 * action to the operating system.
 *
 * So the property is tested directly rather than case by case: a re-spelling that the shell or the
 * filesystem resolves to the same action must not change the verdict. Each new bypass of this class
 * becomes one line in a table here rather than a new test file.
 */

const ctx: SecurityDecisionAdapter.Context = {
  workspace: "/w",
  effective: "allow",
  humanOnly: false,
  floor: { action: "allow", authority: "untrusted", conflict: false },
  containment: { sandbox: "unknown", network: "allow", destinations: [], escalated: false },
}

function shell(argv: readonly string[]) {
  return SecurityDecisionAdapter.evaluate(
    {
      permission: "bash",
      patterns: [argv.join(" ")],
      metadata: {
        securityFacts: {
          complete: true,
          composed: false,
          executable: argv[0],
          argv: [...argv],
          effects: [],
          classified: false,
        },
      },
      sessionID: "ses_spelling",
    },
    ctx,
  )
}

function edit(file: string) {
  return SecurityDecisionAdapter.evaluate(
    { permission: "edit", patterns: [file], metadata: { filepath: file }, sessionID: "ses_spelling" },
    ctx,
  )
}

/**
 * Re-spellings the shell resolves away before the program is reached. Each one is surgical: it
 * rewrites the single token the policy actually matches on, because rewriting the whole line would
 * also hide the verb and pass for the wrong reason.
 */
const RESPELLINGS: ReadonlyArray<{ name: string; of: (argv: readonly string[]) => string[] }> = [
  { name: "a double-quoted flag", of: (a) => a.map((t) => (t.startsWith("-") ? `"${t}"` : t)) },
  { name: "a single-quoted flag", of: (a) => a.map((t) => (t.startsWith("-") ? `'${t}'` : t)) },
  { name: "a backslash-escaped flag", of: (a) => a.map((t) => (t.startsWith("-") ? `\\${t}` : t)) },
  {
    name: "a quoted operand",
    of: (a) => a.map((t, i) => (i >= 2 && !t.startsWith("-") ? `"${t}"` : t)),
  },
  { name: "the executable in another case", of: (a) => [a[0]!.toUpperCase(), ...a.slice(1)] },
]

/** Commands the layer has an opinion about, each in its canonical spelling. */
const HELD = [
  ["git", "log", "-p"],
  ["git", "show", "HEAD:.env"],
  ["git", "diff"],
  ["git", "push", "origin", "main"],
]

describe("a re-spelling does not change the verdict", () => {
  for (const argv of HELD) {
    const canonical = shell(argv)
    for (const spelling of RESPELLINGS) {
      test(`${argv.join(" ")} — ${spelling.name}`, () => {
        const out = shell(spelling.of(argv))
        // The verdict is the property, not the wording of the reason: two spellings may reach the
        // same hold down different rules, and which rule explains it is not a security claim.
        expect({ decision: out.decision, reviewable: out.reviewable }).toEqual({
          decision: canonical.decision,
          reviewable: canonical.reviewable,
        })
      })
    }
  }
})

describe("a path names the same file however it is written", () => {
  const held = edit("package.json")

  test.each([
    ["another case", "Package.json"],
    ["a redundant prefix", "./package.json"],
    ["a redundant traversal", "src/../package.json"],
  ])("%s is the same manifest", (_name, file) => {
    const out = edit(file)
    expect({ decision: out.decision, rule: out.rule_id }).toEqual({ decision: held.decision, rule: held.rule_id })
  })

  // A plain file, dangerous for one reason only: it is not in the workspace. A credential name here
  // would pass on its own regex and prove nothing about how the path itself was placed.
  // The canonical spelling of some manifests is itself mixed case, so folding only the input leaves
  // exactly those names unmatched — the fold has to meet on ground neither side chose.
  test.each([
    ["a lowercased Cargo.toml", "cargo.toml"],
    ["an uppercased Cargo.toml", "CARGO.TOML"],
    ["a lowercased Gemfile", "gemfile"],
    ["a lowercased Pipfile", "pipfile"],
  ])("%s is still a manifest", (_name, file) => {
    expect(edit(file).decision).toBe(held.decision)
  })

  test.each([
    ["a drive letter", "C:\\Users\\me\\notes.txt"],
    ["a drive letter with forward slashes", "C:/Users/me/notes.txt"],
    ["a UNC share", "\\\\server\\share\\notes.txt"],
  ])("%s is outside the workspace", (_name, file) => {
    expect(edit(file).decision).not.toBe("pass")
  })
})

describe("an allowlist constrains every dimension it claims to", () => {
  test("an inert executable is not inert with a mutating flag", () => {
    expect(shell(["date"]).decision).toBe("pass")
    expect(shell(["date", "-s", "12:00"]).decision).not.toBe("pass")
  })

  test("a positional argument that mutates is not a listing", () => {
    expect(shell(["git", "branch", "--list"]).decision).toBe("pass")
    expect(shell(["git", "branch", "topic"]).decision).not.toBe("pass")
  })

  test("a value the layer cannot read is not a value it may trust", () => {
    expect(shell(["git", "log", "$FLAG"]).decision).not.toBe("pass")
  })
})

describe("a guard on an allowlist is itself an allowlist", () => {
  // An entry that is inert only in some forms carries a guard, and a guard written as "not these
  // known-bad flags" is the same wrong-dimension mistake one level down: the next mutating flag is
  // simply one nobody listed. A guard has to account for every operand positively.
  test.each([
    ["date sets the clock with an attached value", ["date", "-s12:00"]],
    ["date sets the clock with a separate value", ["date", "-s", "12:00"]],
    ["hostname sets the name from a file", ["hostname", "--file=/tmp/name"]],
    ["hostname sets the name from a file, short form", ["hostname", "-F", "/tmp/name"]],
    ["hostname renames the host", ["hostname", "evil"]],
  ])("%s", (_name, argv) => {
    expect(shell(argv).decision).not.toBe("pass")
  })

  test.each([
    ["date", ["date", "--frobnicate"]],
    ["hostname", ["hostname", "--frobnicate"]],
  ])("an operand %s's guard cannot account for is not cleared", (_name, argv) => {
    expect(shell(argv).decision).not.toBe("pass")
  })

  test.each([
    ["date alone", ["date"]],
    ["date in a format", ["date", "+%Y-%m-%d"]],
    ["date in UTC", ["date", "-u"]],
    ["hostname alone", ["hostname"]],
    ["hostname reporting the fqdn", ["hostname", "-f"]],
  ])("%s stays inert", (_name, argv) => {
    expect(shell(argv).decision).toBe("pass")
  })
})
