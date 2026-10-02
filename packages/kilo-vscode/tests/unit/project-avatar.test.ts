import { describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { avatar, origin, owner } from "../../src/agent-manager/project/avatar"

function repo(url: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-"))
  fs.mkdirSync(path.join(root, ".git"))
  fs.writeFileSync(
    path.join(root, ".git", "config"),
    `[remote "upstream"]\n\turl = git@github.com:other/x.git\n[remote "origin"]\n\turl = ${url}\n`,
  )
  return root
}

describe("project avatar", () => {
  it("parses GitHub owners from remote URLs", () => {
    expect(owner("git@github.com:Kilo-Org/kilocode.git")).toBe("Kilo-Org")
    expect(owner("git@github.com-work:Kilo-Org/kilocode.git")).toBe("Kilo-Org")
    expect(owner("https://github.com/Kilo-Org/kilocode")).toBe("Kilo-Org")
    expect(owner("https://gitlab.com/foo/bar.git")).toBeUndefined()
  })

  it("reads the origin remote from git config", () => {
    expect(origin(repo("git@github.com:Kilo-Org/kilocode.git"))).toBe("Kilo-Org")
    expect(origin(repo("git@gitlab.com:team/private.git"))).toBeUndefined()
    expect(origin(fs.mkdtempSync(path.join(os.tmpdir(), "avatar-")))).toBeUndefined()
  })

  it("serves a cached avatar from disk as a data URL", () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-cache-"))
    process.env.XDG_CACHE_HOME = cache
    fs.mkdirSync(path.join(cache, "kilo", "project-avatars"), { recursive: true })
    fs.writeFileSync(path.join(cache, "kilo", "project-avatars", "cached-org.png"), "png")
    expect(avatar(repo("git@github.com:Cached-Org/x.git"))).toBe(
      `data:image/png;base64,${Buffer.from("png").toString("base64")}`,
    )
    expect(avatar(repo("git@gitlab.com:team/private.git"))).toBeUndefined()
  })

  it("returns undefined instead of throwing when git config cannot be read", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-"))
    // A directory named config makes readFileSync throw (EISDIR).
    fs.mkdirSync(path.join(root, ".git", "config"), { recursive: true })
    expect(() => avatar(root)).not.toThrow()
    expect(avatar(root)).toBeUndefined()
  })
})
