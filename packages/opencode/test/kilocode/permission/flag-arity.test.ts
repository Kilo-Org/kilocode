import { test, expect, describe } from "bun:test"
import { KiloFlagArity } from "../../../src/kilocode/permission/flag-arity"

describe("KiloFlagArity.prefix", () => {
  test("pnpm --filter <name> <subcommand> keeps the filter pair intact", () => {
    // pnpm has arity 2, so the upstream behavior would slice ["pnpm", "--filter"]
    // and produce the chip "pnpm --filter *". We want the full command instead.
    expect(KiloFlagArity.prefix(["pnpm", "--filter", "web", "typecheck"])).toEqual([
      "pnpm",
      "--filter",
      "web",
      "typecheck",
    ])
  })

  test("pnpm --filter <name> run <script> applies pnpm-run arity 3", () => {
    expect(KiloFlagArity.prefix(["pnpm", "--filter", "web", "run", "build"])).toEqual([
      "pnpm",
      "--filter",
      "web",
      "run",
      "build",
    ])
  })

  test("pnpm -F (short form) is treated like --filter", () => {
    expect(KiloFlagArity.prefix(["pnpm", "-F", "web", "typecheck"])).toEqual(["pnpm", "-F", "web", "typecheck"])
  })

  test("npm --workspace <name> <subcommand>", () => {
    expect(KiloFlagArity.prefix(["npm", "--workspace", "ui", "install"])).toEqual([
      "npm",
      "--workspace",
      "ui",
      "install",
    ])
  })

  test("git -C <path> <subcommand> keeps the cwd flag", () => {
    expect(KiloFlagArity.prefix(["git", "-C", "/tmp/repo", "status"])).toEqual(["git", "-C", "/tmp/repo", "status"])
  })

  test("cargo --package <name> <subcommand>", () => {
    expect(KiloFlagArity.prefix(["cargo", "--package", "core", "build"])).toEqual([
      "cargo",
      "--package",
      "core",
      "build",
    ])
  })

  test("commands without a known flag fall through to upstream arity", () => {
    expect(KiloFlagArity.prefix(["pnpm", "install"])).toEqual(["pnpm", "install"])
    expect(KiloFlagArity.prefix(["git", "checkout", "main"])).toEqual(["git", "checkout"])
    expect(KiloFlagArity.prefix(["docker", "compose", "up", "service"])).toEqual(["docker", "compose", "up"])
  })

  test("unknown flag is left to upstream arity (no special handling)", () => {
    // --silent is not in the FLAG_ARG table, so we keep upstream behavior.
    expect(KiloFlagArity.prefix(["pnpm", "--silent", "install"])).toEqual(["pnpm", "--silent"])
  })

  test("pnpm --filter without subcommand returns command + flag pair", () => {
    expect(KiloFlagArity.prefix(["pnpm", "--filter", "web"])).toEqual(["pnpm", "--filter", "web"])
  })

  test("multiple flag pairs at the start are all preserved", () => {
    expect(KiloFlagArity.prefix(["npm", "--workspace", "a", "--workspace", "b", "run", "build"])).toEqual([
      "npm",
      "--workspace",
      "a",
      "--workspace",
      "b",
      "run",
      "build",
    ])
  })

  test("flag mid-command is not consumed once a non-flag pair has been seen", () => {
    // The second token is not a known flag, so we fall through entirely.
    expect(KiloFlagArity.prefix(["git", "commit", "-C", "/tmp/repo"])).toEqual(["git", "commit"])
  })

  test("empty input returns empty", () => {
    expect(KiloFlagArity.prefix([])).toEqual([])
  })

  test("single token returns itself", () => {
    expect(KiloFlagArity.prefix(["pnpm"])).toEqual(["pnpm"])
  })

  test("known flag without an argument falls through (malformed input)", () => {
    // tokens.length === 2, no arg available — preserve upstream behavior.
    expect(KiloFlagArity.prefix(["pnpm", "--filter"])).toEqual(["pnpm", "--filter"])
  })
})
