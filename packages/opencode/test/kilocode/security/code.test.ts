// The trust boundary for executable project code.
//
// `discovery != execution`. A `.kilocode/tool/*.ts` file or a project plugin runs its module scope the
// instant Kilo imports it — before any tool call, before the sandbox, before the model has done
// anything. These tests pin the decision that has to happen in between, and pin equally hard the
// things that must NOT be able to grant it: the file's own exports, its name, or the project's config.
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { CodeTrust } from "@/kilocode/security/code/trust"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-security-code-"))
const project = path.join(await fs.realpath(root), "repo", ".kilocode", "tool")
const globalDir = path.join(Global.Path.config, "tool")
await fs.mkdir(project, { recursive: true })
await fs.mkdir(globalDir, { recursive: true })

const SOURCE = [
  `import fs from "node:fs"`,
  `fs.writeFileSync("/tmp/should-never-happen", "x")`,
  `export const trusted = true`,
  `export default { description: "helper", args: {}, execute: async () => "ok" }`,
  ``,
].join("\n")

async function seed(dir: string, name: string, content = SOURCE) {
  const file = path.join(dir, name)
  await fs.writeFile(file, content)
  return file
}

const policy = (enabled: boolean, approved: string[] = []) => ({ enabled, approved: new Set(approved) })

afterEach(() => {
  CodeTrust.resetBlocked()
})

describe("origin classification", () => {
  test("a file in the user's global config directory is trusted configuration", async () => {
    const file = await seed(globalDir, "global-origin.ts")
    expect(CodeTrust.classify({ file })).toBe("trusted-config")
  })

  test("a file in a repository is workspace-controlled", async () => {
    const file = await seed(project, "project-origin.ts")
    expect(CodeTrust.classify({ file })).toBe("workspace")
  })

  test("a locally-declared entry stays workspace-controlled even inside the global directory", async () => {
    const file = await seed(globalDir, "declared-locally.ts")
    // A project config declaring a dependency that resolves into a shared cache is still the project's
    // choice: `scope` may only lower trust.
    expect(CodeTrust.classify({ file, scope: "local" })).toBe("workspace")
  })

  test("a global-scope declaration is trusted configuration wherever it resolves", async () => {
    const file = await seed(project, "declared-globally.ts")
    expect(CodeTrust.classify({ file, scope: "global" })).toBe("trusted-config")
  })
})

describe("trust decision", () => {
  test("an untrusted project file is not imported", async () => {
    const file = await seed(project, "untrusted.ts")
    const decision = CodeTrust.guard({ file, kind: "custom-tool", policy: policy(true) })
    expect(decision.allow).toBe(false)
    expect(decision.reason).toBe("untrusted-origin")
    expect(decision.origin).toBe("workspace")
  })

  test("the file's own exports cannot grant it trust", async () => {
    const file = await seed(
      project,
      "self-declared.ts",
      [`export const trusted = true`, `export const security = { approved: true }`, SOURCE].join("\n"),
    )
    expect(CodeTrust.guard({ file, kind: "custom-tool", policy: policy(true) }).allow).toBe(false)
  })

  test("a user approval of exactly this content lets it load", async () => {
    const file = await seed(project, "approved.ts")
    const digest = CodeTrust.digest(file)!
    const decision = CodeTrust.guard({ file, kind: "custom-tool", policy: policy(true, [digest]) })
    expect(decision.allow).toBe(true)
    expect(decision.reason).toBe("approved-digest")
  })

  test("an unchanged approved file keeps loading — approval is not one-shot", async () => {
    const file = await seed(project, "reused.ts")
    const digest = CodeTrust.digest(file)!
    for (let i = 0; i < 3; i++) {
      expect(CodeTrust.guard({ file, kind: "custom-tool", policy: policy(true, [digest]) }).allow).toBe(true)
    }
  })

  test("changing the content after approval revokes it", async () => {
    const file = await seed(project, "changed.ts")
    const digest = CodeTrust.digest(file)!
    await fs.writeFile(file, SOURCE + "\n// smuggled\n")
    const decision = CodeTrust.guard({ file, kind: "custom-tool", policy: policy(true, [digest]) })
    expect(decision.allow).toBe(false)
    expect(decision.digest).not.toBe(digest)
  })

  test("approving one file does not approve its neighbour", async () => {
    const approved = await seed(project, "one.ts")
    const other = await seed(project, "two.ts", SOURCE + "\n// different\n")
    const digest = CodeTrust.digest(approved)!
    expect(CodeTrust.guard({ file: other, kind: "custom-tool", policy: policy(true, [digest]) }).allow).toBe(false)
  })

  test("a trusted-origin file needs no approval", async () => {
    const file = await seed(globalDir, "trusted-origin.ts")
    const decision = CodeTrust.guard({ file, kind: "custom-tool", policy: policy(true) })
    expect(decision.allow).toBe(true)
    expect(decision.reason).toBe("trusted-origin")
  })

  test("an unreadable candidate is refused, never assumed safe", () => {
    const decision = CodeTrust.guard({
      file: path.join(project, "does-not-exist.ts"),
      kind: "custom-tool",
      policy: policy(true),
    })
    expect(decision.allow).toBe(false)
    expect(decision.reason).toBe("unreadable")
  })

  test("with the layer off every candidate loads exactly as before", async () => {
    const file = await seed(project, "legacy.ts")
    const decision = CodeTrust.guard({ file, kind: "custom-tool", policy: policy(false) })
    expect(decision.allow).toBe(true)
    expect(decision.reason).toBe("layer-off")
  })
})

describe("approval provenance", () => {
  test("only the global config's digest list is read", () => {
    const digest = "a".repeat(64)
    // What a project config would try to say.
    const project = { experimental: { security_auto_code_trust: [digest] } }
    // The policy is built from the *global* config only; the loaders never pass a merged config.
    expect(CodeTrust.policy(project, true).approved.has(digest)).toBe(true)
    expect(CodeTrust.policy({ experimental: {} }, true).approved.has(digest)).toBe(false)
  })

  test("malformed approval entries are dropped rather than trusted", () => {
    const approved = CodeTrust.policy(
      { experimental: { security_auto_code_trust: ["not-a-digest", "*", 42, "b".repeat(63), "C".repeat(64)] } },
      true,
    ).approved
    expect(approved.size).toBe(1)
    expect(approved.has("c".repeat(64))).toBe(true)
  })
})

describe("audit surface", () => {
  test("a blocked candidate is recorded with its digest and never its contents", async () => {
    const file = await seed(project, "recorded.ts", `const SECRET_MARKER = "do-not-appear-in-audit"\n` + SOURCE)
    CodeTrust.guard({ file, kind: "custom-tool", policy: policy(true) })
    const items = CodeTrust.blocked()
    expect(items).toHaveLength(1)
    expect(items[0]?.file).toBe(file)
    expect(items[0]?.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(items)).not.toContain("do-not-appear-in-audit")
  })

  test("the approval hint names the digest a human must add, and nothing else", async () => {
    const file = await seed(project, "hinted.ts")
    CodeTrust.guard({ file, kind: "custom-tool", policy: policy(true) })
    const hint = CodeTrust.approvalHint(CodeTrust.blocked()[0]!)
    expect(hint).toContain("security_auto_code_trust")
    expect(hint).toContain(CodeTrust.digest(file)!)
    expect(hint).not.toContain("writeFileSync")
  })
})

describe("adversarial variants", () => {
  test("a symlink is judged by the bytes it resolves to", async () => {
    const target = await seed(project, "symlink-target.ts")
    const link = path.join(project, "symlink.ts")
    await fs.rm(link, { force: true })
    await fs.symlink(target, link)
    const digest = CodeTrust.digest(link)
    expect(digest).toBe(CodeTrust.digest(target))
    // Approving the target therefore also approves reading it through the link — and swapping the
    // target's contents revokes both.
    expect(CodeTrust.guard({ file: link, kind: "custom-tool", policy: policy(true, [digest!]) }).allow).toBe(true)
    await fs.writeFile(target, SOURCE + "\n// swapped\n")
    expect(CodeTrust.guard({ file: link, kind: "custom-tool", policy: policy(true, [digest!]) }).allow).toBe(false)
  })

  test("renaming an approved file keeps it approved; editing it does not", async () => {
    const file = await seed(project, "before-rename.ts")
    const digest = CodeTrust.digest(file)!
    const renamed = path.join(project, "after-rename.ts")
    await fs.rename(file, renamed)
    // Content-keyed trust is deliberately path-independent: the same reviewed bytes stay approved.
    expect(CodeTrust.guard({ file: renamed, kind: "custom-tool", policy: policy(true, [digest]) }).allow).toBe(true)
  })

  test("a file:// URL is handled like the path it names", async () => {
    const file = await seed(project, "url-form.ts")
    const digest = CodeTrust.digest(file)!
    expect(CodeTrust.digest(`file://${file}`)).toBe(digest)
    expect(CodeTrust.classify({ file: `file://${file}` })).toBe("workspace")
  })

  test("an alternate extension is not a way around discovery", async () => {
    const file = await seed(project, "alternate.mjs")
    expect(CodeTrust.guard({ file, kind: "custom-tool", policy: policy(true) }).allow).toBe(false)
  })
})
