import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { canonicalPath, resolveGlobalConfigDir } from "../src/settings-paths"

describe("resolveGlobalConfigDir", () => {
  test("KILO_CONFIG_DIR and OPENCODE_CONFIG_DIR win", () => {
    expect(resolveGlobalConfigDir({ KILO_CONFIG_DIR: "/cfg/kilo" }, "/prof")).toBe("/cfg/kilo")
    expect(resolveGlobalConfigDir({ OPENCODE_CONFIG_DIR: "/cfg/oc" }, "")).toBe("/cfg/oc")
  })

  test("the dev profile maps to <profile>/config/<app>", () => {
    expect(resolveGlobalConfigDir({}, "/prof")).toBe(path.join("/prof", "config", "kilo2"))
    expect(resolveGlobalConfigDir({ OPENCODE_APP_DIR_NAME: "kilo" }, "/prof")).toBe(
      path.join("/prof", "config", "kilo"),
    )
  })

  test("a bundled server uses XDG_CONFIG_HOME and the app directory", () => {
    expect(resolveGlobalConfigDir({ XDG_CONFIG_HOME: "/xdg" }, "")).toBe(path.join("/xdg", "kilo2"))
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
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
