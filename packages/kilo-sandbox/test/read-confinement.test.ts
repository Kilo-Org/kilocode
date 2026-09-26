// Read confinement, at the level both backends can be checked on any platform: the policy each one
// generates. The end-to-end proof that the policy is actually enforced lives with the extension host
// (`packages/opencode/test/kilocode/security/extension.test.ts`), which runs a real confined process;
// this file exists so the Linux policy is verified somewhere even when the tests run on macOS.
import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { generate as seatbelt } from "../src/seatbelt"
import { generate as bubblewrap } from "../src/bubblewrap"
import type { Launch } from "../src/backend"
import type { Profile } from "../src/profile"

const root = await mkdtemp(join(tmpdir(), "kilo-readconf-"))
const workspace = join(root, "workspace")
const scratch = join(root, "scratch")
const secrets = join(root, "home", ".ssh")
await mkdir(workspace, { recursive: true })
await mkdir(scratch, { recursive: true })
await mkdir(secrets, { recursive: true })
await writeFile(join(secrets, "id_rsa"), "not a real key\n")

afterAll(() => rm(root, { recursive: true, force: true }))

const launch: Launch = { command: "/bin/echo", args: ["hi"], cwd: workspace }

function profile(confineReads: boolean): Profile {
  return {
    filesystem: {
      allowWrite: [{ path: scratch, kind: "subtree" }],
      denyWrite: [],
      denyNames: confineReads ? [".ssh"] : [],
      ...(confineReads
        ? {
            allowRead: [
              { path: workspace, kind: "subtree" as const },
              { path: scratch, kind: "subtree" as const },
            ],
            denyRead: [{ path: join(root, "home"), kind: "subtree" as const }],
          }
        : {}),
      temporaryDirectory: scratch,
    },
    network: { mode: "deny", allowedHosts: [] },
    environment: { deny: [], set: {} },
  }
}

describe("seatbelt", () => {
  test("without allowRead the profile leaves reads open, as every ordinary session expects", () => {
    const policy = seatbelt(profile(false), launch).args[1]!
    expect(policy).toContain("(allow file-read*)")
    expect(policy).not.toContain("file-read-metadata")
  })

  test("with allowRead only the listed subtrees are readable", () => {
    const generated = seatbelt(profile(true), launch)
    const policy = generated.args[1]!
    // Metadata everywhere, because a process that cannot resolve a path cannot start; contents only
    // inside the allowed set.
    expect(policy).toContain("(allow file-read-metadata)")
    expect(policy).not.toContain("\n(allow file-read*)")
    expect(policy).toContain("(allow file-read*\n  (require-all")
    // The root directory entry itself is always granted: without it the runtime aborts.
    expect(policy).toContain('(require-any (literal "/")')
    // Deny rules and deny names apply to reads as well.
    expect(policy).toContain('(require-not (subpath (param "DENY_READ_0")))')
    expect(policy).toContain('(require-not (regex #"(^|/)\\.ssh(/|$)"))')
    const params = generated.args.filter((arg) => arg.startsWith("-DALLOW_READ_"))
    expect(params).toEqual([`-DALLOW_READ_0=${workspace}`, `-DALLOW_READ_1=${scratch}`])
  })
})

describe("bubblewrap", () => {
  const bwrap = "/usr/bin/bwrap"

  test("without allowRead the whole filesystem is bound read-only", () => {
    const args = bubblewrap(profile(false), launch, bwrap, []).args
    expect(args).toContain("--ro-bind")
    expect(args.join(" ")).toContain("--ro-bind / /")
    expect(args).not.toContain("--tmpfs")
  })

  test("with allowRead the root is a tmpfs and only allowed paths are bound in", () => {
    const args = bubblewrap(profile(true), launch, bwrap, []).args
    const joined = args.join(" ")
    // A path that is never bound does not exist for the process, symlinks to it included.
    expect(joined).not.toContain("--ro-bind / /")
    expect(joined).toContain("--tmpfs /")
    expect(joined).toContain(`--ro-bind ${workspace} ${workspace}`)
    expect(joined).toContain(`--ro-bind ${scratch} ${scratch}`)
    expect(joined).not.toContain(join(root, "home", ".ssh", "id_rsa"))
    // The scratch directory is still writable.
    expect(joined).toContain(`--bind ${scratch} ${scratch}`)
  })

  test("a deny-name match inside an allowed subtree is covered rather than left visible", async () => {
    const inside = join(workspace, ".ssh")
    await mkdir(inside, { recursive: true })
    try {
      const joined = bubblewrap(profile(true), launch, bwrap, []).args.join(" ")
      expect(joined).toContain(`--tmpfs ${inside}`)
    } finally {
      await rm(inside, { recursive: true, force: true })
    }
  })
})
