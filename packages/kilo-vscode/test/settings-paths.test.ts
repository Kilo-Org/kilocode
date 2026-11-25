import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { canonicalPath, matchConfigDocument, resolveGlobalConfigDir, resolveKiloProfile } from "../src/settings-paths"

describe("resolveGlobalConfigDir", () => {
  test("KILO_CONFIG_DIR wins over OPENCODE_CONFIG_DIR and the dev profile", () => {
    expect(
      resolveGlobalConfigDir(
        { KILO_CONFIG_DIR: "/cfg/kilo", OPENCODE_CONFIG_DIR: "/cfg/oc" },
        "/prof",
      ),
    ).toBe("/cfg/kilo")
    expect(resolveGlobalConfigDir({ KILO_CONFIG_DIR: "/cfg/kilo" }, "")).toBe("/cfg/kilo")
  })

  test("OPENCODE_CONFIG_DIR is used when KILO_CONFIG_DIR is absent", () => {
    expect(resolveGlobalConfigDir({ OPENCODE_CONFIG_DIR: "/cfg/oc" }, "/prof")).toBe(
      "/cfg/oc",
    )
  })

  test("the dev profile maps to <profile>/config/kilo", () => {
    expect(resolveGlobalConfigDir({}, "/prof")).toBe(path.join("/prof", "config", "kilo"))
    expect(resolveGlobalConfigDir({ OPENCODE_APP_DIR_NAME: "kilo", XDG_CONFIG_HOME: "/xdg" }, "/prof")).toBe(
      path.join("/prof", "config", "kilo"),
    )
  })

  test("a bundled server uses XDG_CONFIG_HOME and the kilo app directory", () => {
    expect(resolveGlobalConfigDir({ XDG_CONFIG_HOME: "/xdg" }, "")).toBe(path.join("/xdg", "kilo"))
    expect(resolveGlobalConfigDir({}, "")).toBe(path.join(os.homedir(), ".config", "kilo"))
  })
})

describe("resolveKiloProfile", () => {
  test("uses KILO_V2_PROFILE, then the extension storage, when there is no bundled binary", () => {
    const context = { extensionPath: "/ext", globalStorageUri: { fsPath: "/storage" } }
    expect(resolveKiloProfile(context, { KILO_V2_PROFILE: "/prof" }, "linux")).toBe("/prof")
    expect(resolveKiloProfile(context, {}, "linux")).toBe(path.join("/storage", "profile"))
  })

  test("uses XDG paths for a bundled binary, even with a dev profile variable", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "kilo-profile-"))
    try {
      await mkdir(path.join(base, "ext", "bin"), { recursive: true })
      await writeFile(path.join(base, "ext", "bin", "kilo"), "")
      const context = { extensionPath: path.join(base, "ext"), globalStorageUri: { fsPath: "/storage" } }
      expect(resolveKiloProfile(context, { KILO_V2_PROFILE: "/prof" }, "linux")).toBe("")
    } finally {
      await rm(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    }
  })
})

describe("canonicalPath", () => {
  test("resolves a symlinked directory, for an existing and a missing file", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "kilo-path-"))
    try {
      const real = path.join(base, "real")
      const link = path.join(base, "link")
      await mkdir(real)
      await writeFile(path.join(real, "kilo.json"), "{}\n")
      // Creating a symlink needs privileges on Windows; skip the assertions when it is not allowed.
      const linked = await symlink(real, link).then(
        () => true,
        () => false,
      )
      if (!linked) return
      expect(await canonicalPath(path.join(link, "kilo.json"))).toBe(await realpath(path.join(real, "kilo.json")))
      expect(await canonicalPath(path.join(link, "missing.json"))).toBe(path.join(await realpath(real), "missing.json"))
      const document = path.join(link, "kilo.json")
      const entries = new Map([[await canonicalPath(document), document]])
      expect(await matchConfigDocument([path.join(real, "kilo.json")], entries)).toBe(document)
      expect(await matchConfigDocument([path.join(real, "missing.json")], entries)).toBeUndefined()
    } finally {
      await rm(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    }
  })
})
