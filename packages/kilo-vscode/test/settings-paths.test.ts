import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { canonicalPath, matchConfigDocument, resolveGlobalConfigDir } from "../src/settings-paths"

describe("resolveGlobalConfigDir", () => {
  test("KILO2_CONFIG_DIR wins over OPENCODE_CONFIG_DIR and the dev profile", () => {
    expect(
      resolveGlobalConfigDir(
        { KILO2_CONFIG_DIR: "/cfg/kilo2", OPENCODE_CONFIG_DIR: "/cfg/oc", KILO_CONFIG_DIR: "/cfg/kilo" },
        "/prof",
      ),
    ).toBe("/cfg/kilo2")
    expect(resolveGlobalConfigDir({ KILO2_CONFIG_DIR: "/cfg/kilo2" }, "")).toBe("/cfg/kilo2")
  })

  test("OPENCODE_CONFIG_DIR is used when KILO2_CONFIG_DIR is absent", () => {
    expect(resolveGlobalConfigDir({ OPENCODE_CONFIG_DIR: "/cfg/oc", KILO_CONFIG_DIR: "/cfg/kilo" }, "/prof")).toBe(
      "/cfg/oc",
    )
  })

  test("KILO_CONFIG_DIR does not select the v2 config directory", () => {
    expect(resolveGlobalConfigDir({ KILO_CONFIG_DIR: "/cfg/kilo" }, "/prof")).toBe(
      path.join("/prof", "config", "kilo2"),
    )
    expect(resolveGlobalConfigDir({ KILO_CONFIG_DIR: "/cfg/kilo", XDG_CONFIG_HOME: "/xdg" }, "")).toBe(
      path.join("/xdg", "kilo2"),
    )
  })

  test("the dev profile maps to <profile>/config/kilo2", () => {
    expect(resolveGlobalConfigDir({}, "/prof")).toBe(path.join("/prof", "config", "kilo2"))
    expect(resolveGlobalConfigDir({ OPENCODE_APP_DIR_NAME: "kilo", XDG_CONFIG_HOME: "/xdg" }, "/prof")).toBe(
      path.join("/prof", "config", "kilo2"),
    )
  })

  test("a bundled server uses XDG_CONFIG_HOME and the kilo2 app directory", () => {
    expect(resolveGlobalConfigDir({ XDG_CONFIG_HOME: "/xdg" }, "")).toBe(path.join("/xdg", "kilo2"))
    expect(resolveGlobalConfigDir({}, "")).toBe(path.join(os.homedir(), ".config", "kilo2"))
  })
})

describe("canonicalPath", () => {
  test("resolves a symlinked directory, for an existing and a missing file", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "kilo-path-"))
    try {
      const real = path.join(base, "real")
      const link = path.join(base, "link")
      await mkdir(real)
      await writeFile(path.join(real, "kilo2.json"), "{}\n")
      // Creating a symlink needs privileges on Windows; skip the assertions when it is not allowed.
      const linked = await symlink(real, link).then(
        () => true,
        () => false,
      )
      if (!linked) return
      expect(await canonicalPath(path.join(link, "kilo2.json"))).toBe(await realpath(path.join(real, "kilo2.json")))
      expect(await canonicalPath(path.join(link, "missing.json"))).toBe(path.join(await realpath(real), "missing.json"))
      const document = path.join(link, "kilo2.json")
      const entries = new Map([[await canonicalPath(document), document]])
      expect(await matchConfigDocument([path.join(real, "kilo2.json")], entries)).toBe(document)
      expect(await matchConfigDocument([path.join(real, "missing.json")], entries)).toBeUndefined()
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
