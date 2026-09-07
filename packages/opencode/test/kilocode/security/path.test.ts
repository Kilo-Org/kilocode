import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { SandboxStore } from "../../../src/kilocode/sandbox/store"
import { PathRisk } from "../../../src/kilocode/security/path"
import { classificationFixture } from "./fixture"

// The fixture declares its own home, temp root and external directory, so "external" cannot be
// swallowed by whichever temp root the OS happens to put the fixture under. See ./fixture.ts.
const fixture = await classificationFixture("kilo-security-path-", ["code", "app"])
const { home, ws, temp, external, env } = fixture

beforeAll(async () => {
  await fs.mkdir(path.join(home, ".ssh"), { recursive: true })
  await fs.mkdir(path.join(ws, "src"), { recursive: true })
  await fs.writeFile(path.join(home, ".ssh", "id_rsa"), "")
  await fs.symlink(path.join(home, ".ssh"), path.join(ws, "keys"))
  await fs.symlink(path.join(ws, "src"), path.join(external, "srclink"))
})

afterAll(async () => {
  await fixture.cleanup()
})

const at = (input: string, cwd: string | undefined = ws) => PathRisk.classify(input, cwd, env)

describe("PathRisk classification", () => {
  test("workspace paths, root and config", () => {
    expect(at("src/index.ts").relation).toBe("workspace")
    expect(at("./build").relation).toBe("workspace")
    expect(at(".").relation).toBe("workspace-root")
    expect(at(ws).relation).toBe("workspace-root")
    expect(at("kilo.json").relation).toBe("workspace-config")
    expect(at("opencode.jsonc").relation).toBe("workspace-config")
    expect(at("AGENTS.md").relation).toBe("workspace-config")
    expect(at(".kilo/tool/x.ts").relation).toBe("workspace-config")
    expect(at(".kilocode/agents/x.md").relation).toBe("workspace-config")
    expect(at("packages/a/.kilo/x").relation).toBe("workspace-config")
    expect(at(".kilo/plans/x.md").relation).toBe("workspace")
    expect(at(".git/config").labels).toContain("git-dir")
    expect(at(".env").labels).toContain("secret")
    expect(at(".env.local").labels).toContain("secret")
    expect(at(".env.example").labels).not.toContain("secret")
    expect(at("certs/dev.pem").labels).toContain("private-key")
  })

  test("home, sensitive locations and labels", () => {
    expect(at("~").relation).toBe("home-root")
    expect(at(home).relation).toBe("home-root")
    expect(at("$HOME").relation).toBe("home-root")
    expect(at("~/Documents/notes.md").relation).toBe("home")
    expect(at("~/.ssh").relation).toBe("home-sensitive")
    expect(at("~/.ssh/id_rsa").labels).toEqual(expect.arrayContaining(["credential", "private-key"]))
    expect(at("~/.ssh/config").labels).toEqual(["credential"])
    expect(at("~/.ssh/id_ed25519.pub").labels).toEqual(["credential"])
    expect(at("~/.aws/credentials").labels).toContain("private-key")
    expect(at("~/.aws/config").labels).toEqual(["credential"])
    expect(at("~/.kube/config").labels).toContain("private-key")
    expect(at("~/.netrc").labels).toContain("private-key")
    expect(at("~/.bashrc").labels).toEqual(["shell-persistence"])
    expect(at("~/.zshrc").relation).toBe("home-sensitive")
    expect(at("~/.config/fish/config.fish").labels).toEqual(["shell-persistence"])
    expect(at("~/Library/LaunchAgents/x.plist").labels).toEqual(["shell-persistence"])
    expect(at("~/.gitconfig").labels).toEqual(["git-identity"])
    expect(at("~/.git-credentials").labels).toContain("private-key")
    expect(PathRisk.secret(at("~/.ssh/id_rsa"))).toBe(true)
    expect(PathRisk.secret(at("~/.ssh/config"))).toBe(false)
  })

  test("system, temp, device and external", () => {
    expect(at("/").relation).toBe("root")
    expect(at("/etc/passwd").relation).toBe("system")
    expect(at("/usr/local/bin/x").relation).toBe("system")
    expect(at("/System/Library").relation).toBe("system")
    expect(at("/dev/sda").labels).toContain("device")
    expect(at("/dev/null").labels).not.toContain("device")
    expect(at("/etc/cron.d/job").labels).toContain("shell-persistence")
    expect(at(path.join(temp, "scratch", "x")).relation).toBe("temp")
    expect(at(temp).relation).toBe("external")
    expect(at(path.join(external, "x")).relation).toBe("external")
    expect(at(path.dirname(ws)).labels).toContain("workspace-ancestor")
    expect(at(home).labels).toContain("workspace-ancestor")
  })

  test("Kilo configuration and state are protected", () => {
    expect(at(path.join(Global.Path.config, "kilo.json")).relation).toBe("kilo-security")
    expect(at(path.join(Global.Path.config, "kilo.json")).labels).toContain("kilo-config")
    expect(at(path.join(Global.Path.state, "x")).relation).toBe("kilo-security")
    expect(at(path.join(SandboxStore.root, "abc")).relation).toBe("kilo-security")
    expect(at(path.join(Global.Path.data, "auth.json")).labels).toContain("kilo-state")
    expect(at("~/.kilo/skills/x/SKILL.md").relation).toBe("kilo-security")
    expect(at("~/.config/kilo/kilo.json").relation).toBe("kilo-security")
    expect(at(path.join(Global.Path.data, "plans", "x.md")).relation).not.toBe("kilo-security")
  })

  test("traversal, symlinks and canonicalisation", () => {
    expect(at("../../.ssh/id_rsa").relation).toBe("home-sensitive")
    expect(at("src/../../../.ssh").relation).toBe("home-sensitive")
    expect(at("../app/src/x.ts").relation).toBe("workspace")
    const linked = at("keys/id_rsa")
    expect(linked.relation).toBe("home-sensitive")
    expect(linked.symlink).toBe(true)
    expect(linked.canonical).toBe(path.join(home, ".ssh", "id_rsa"))
    const inward = at(path.join(external, "srclink", "x.ts"))
    expect(inward.relation).toBe("external")
    expect(at("../../.ssh/missing/deeper").relation).toBe("home-sensitive")
    expect(at("../../.ssh/missing/deeper").exists).toBe(false)
  })

  test("unknown cwd and dynamic input stay unknown", () => {
    expect(PathRisk.classify("build", undefined, env).relation).toBe("unknown")
    expect(at("$DIR/build").relation).toBe("unknown")
    expect(at("`pwd`/x").relation).toBe("unknown")
    expect(PathRisk.classify("/etc", undefined, env).relation).toBe("system")
  })

  // The fixture's own roots. These are what the "external" scenarios above stand on: if the
  // declared temp root ever swallowed the external directory again, external verdicts would
  // quietly downgrade to temp (which ranks lower) instead of failing loudly here.
  test("the fixture's declared temp root and external directory stay distinct", () => {
    expect(at(path.join(temp, "scratch", "x")).relation).toBe("temp")
    expect(at(temp).relation).toBe("external")
    expect(at(path.join(external, "x")).relation).toBe("external")
    expect(at(external).relation).toBe("external")
    // Nothing external is inside the declared temp root, and nothing is inside the other roots.
    for (const root of [temp, home, ws]) expect(path.relative(root, external).startsWith("..")).toBe(true)
  })

  // The fixture reclassifies its own roots; production must not follow it. A default environment
  // still treats the OS temp dirs as temp, so moving the fixture did not relax real policy.
  //
  // The root itself is deliberately *not* temp: emptying a whole temp root is not a temp operation,
  // so a declared root classifies as external while everything under it is temp. `os.tmpdir()`
  // cannot stand in for that check, because it is only a declared root on some systems — on Linux
  // it is `/tmp`, which is one; on macOS it is a per-user directory *inside* `/var/folders`, which
  // is the declared root, so it classifies as temp and correctly so. The roots below are named in
  // the defaults on both.
  test("production defaults still treat the OS temp roots as temp", () => {
    const production = PathRisk.env({ workspace: { directory: ws, worktree: ws } })
    const classify = (input: string) => PathRisk.classify(input, ws, production).relation
    expect(classify(path.join(os.tmpdir(), "scratch", "x"))).toBe("temp")
    expect(classify("/tmp/scratch/x")).toBe("temp")
    expect(classify("/tmp")).toBe("external")
    expect(classify("/var/tmp")).toBe("external")
  })
})
