import { describe, expect } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { RipgrepBinary } from "@opencode-ai/core/ripgrep/binary"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Ripgrep.node, RipgrepBinary.node])))

const gitignore = ["build/", "node_modules/", "*.gen.ts", "out/*", "!out/keep.txt", ".cache/", ".env", "secret/"]

const files = [
  "src/a.ts",
  "src/b.tsx",
  "src/.hidden.ts",
  "src/gen/c.gen.ts",
  "src/gen/d.ts",
  "build/x.ts",
  "build/sub/y.ts",
  "node_modules/pkg/index.ts",
  "node_modules/pkg/dist/z.js",
  "lib/i.ts",
  "lib/node_modules/x/h.ts",
  ".github/workflows/ci.yml",
  ".github/README.md",
  ".cache/deep/e.ts",
  ".hidden.d/f.ts",
  ".vscode/settings.json",
  "docs/guide.md",
  "docs/notes.local.md",
  "docs/.drafts/g.md",
  "out/drop.txt",
  "out/keep.txt",
  "ignored-by-dotignore/n.ts",
  "secret/o.ts",
  "a.ts.d/m.ts",
  "sp ace/k l.ts",
  ".env",
  ".env.example",
  ".eslintrc.json",
  "package.json",
  "README.md",
]

// Typical agent patterns plus the edge cases where ripgrep's override rules are subtle.
const patterns = [
  "**/*",
  "*",
  "**",
  "**/*.ts",
  "*.ts",
  "**/*.{ts,tsx}",
  "src/**/*.ts",
  "src/*",
  "/package.json",
  "package.json",
  "**/package.json",
  "**/README.md",
  "README*",
  "**/*.md",
  "docs/**",
  "**/.*",
  ".*",
  "**/.env*",
  "**/.*rc.*",
  ".github/**",
  "**/.github/**/*",
  ".github/",
  "**/.*/**",
  ".*/**",
  "**/*.ts/",
  "*.d/**",
  "a.ts.d/*",
  "**/[A-Z]*.md",
  "**/[!.]*.md",
  "**/*.[jt]s",
  "**/sp ace/*",
  "**/* *",
  "out/*",
  "**/keep*",
  "**/node_modules/**",
  "**/node_modules",
  "node_modules/**",
  "lib/**/*.ts",
  "{**/package.json,**/*.yml}",
  "**/**/*.ts",
  "./src/*.ts",
]

const seed = async (dir: string) => {
  await Bun.$`git init -q ${dir}`.quiet()
  await Bun.write(path.join(dir, ".gitignore"), gitignore.join("\n") + "\n")
  await Bun.write(path.join(dir, ".ignore"), "ignored-by-dotignore/\n")
  await Bun.write(path.join(dir, "docs", ".gitignore"), "*.local.md\n")
  await Promise.all(files.map((file) => Bun.write(path.join(dir, file), "x\n")))
}

/** List files with ripgrep directly, the way the glob search worked before matching moved out of ripgrep. */
const list = async (rg: string, cwd: string, args: string[]) => {
  const proc = Bun.spawn([rg, "--no-config", "--files", ...args, "--glob=!**/.git/**", "."], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  })
  const text = await new Response(proc.stdout).text()
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace(/^(?:\.[\\/])+/u, "").replaceAll("\\", "/"))
}

/** True when this ripgrep build rejects the glob, which differs across ripgrep versions. */
const rejects = async (rg: string, cwd: string, pattern: string) => {
  const proc = Bun.spawn([rg, "--no-config", "--files", `--glob=${pattern}`, "."], {
    cwd,
    stdout: "ignore",
    stderr: "pipe",
  })
  const text = await new Response(proc.stderr).text()
  return (await proc.exited) === 2 && text.includes("error parsing glob")
}

const run = (input: Omit<Ripgrep.GlobInput, "limit"> & { limit?: number }) =>
  Effect.gen(function* () {
    const result = yield* (yield* Ripgrep.Service).glob({ limit: 10_000, ...input })
    return { ...result, paths: result.items.map((item) => String(item.path)).sort() }
  })

describe("Kilo ripgrep glob", () => {
  it.live("matches exactly what ripgrep matched before, minus ignored files", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => seed(tmp.path))
          const rg = yield* (yield* RipgrepBinary.Service).filepath
          const allowed = new Set(yield* Effect.promise(() => list(rg, tmp.path, ["--hidden"])))
          for (const hidden of [false, true]) {
            for (const pattern of patterns) {
              const before = yield* Effect.promise(() =>
                list(rg, tmp.path, [...(hidden ? ["--hidden"] : []), `--glob=${pattern}`]),
              )
              const result = yield* run({ cwd: tmp.path, pattern, hidden })
              expect({ pattern, hidden, paths: result.paths }).toEqual({
                pattern,
                hidden,
                paths: before.filter((file) => allowed.has(file)).sort(),
              })
            }
          }
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("keeps ignored folders and files out of results", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => seed(tmp.path))
          const all = yield* run({ cwd: tmp.path, pattern: "**/*" })
          expect(all.paths.filter((file) => /node_modules|build\/|secret\/|\.gen\.ts|drop\.txt/.test(file))).toEqual([])
          expect(all.paths).toContain("out/keep.txt")
          expect((yield* run({ cwd: tmp.path, pattern: "**/.env*" })).paths).toEqual([".env.example"])
          expect((yield* run({ cwd: tmp.path, pattern: "**/*.ts" })).paths).toEqual([
            "a.ts.d/m.ts",
            "lib/i.ts",
            "sp ace/k l.ts",
            "src/.hidden.ts",
            "src/a.ts",
            "src/gen/d.ts",
          ])
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("applies the limit after dropping ignored paths", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => seed(tmp.path))
          yield* Effect.promise(() =>
            Promise.all(
              Array.from({ length: 50 }, (_, index) =>
                Bun.write(path.join(tmp.path, "node_modules", "many", `${index}.ts`), "x\n"),
              ),
            ),
          )
          const first = yield* run({ cwd: tmp.path, pattern: "**/*.ts", limit: 2 })
          expect(first.paths).toHaveLength(2)
          expect(first.truncated).toBe(true)
          expect(first.paths.some((file) => file.includes("node_modules"))).toBe(false)
          const exact = yield* run({ cwd: tmp.path, pattern: "**/*.ts", limit: 6 })
          expect(exact.truncated).toBe(false)
          expect(exact.paths).toHaveLength(6)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("applies a caller filter before the limit", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => seed(tmp.path))
          const result = yield* run({
            cwd: tmp.path,
            pattern: "**/*.ts",
            limit: 1,
            filter: (file) => file.startsWith("lib/"),
          })
          expect(result.paths).toEqual(["lib/i.ts"])
          expect(result.truncated).toBe(false)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("reports malformed patterns as invalid", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => seed(tmp.path))
          const rg = yield* (yield* RipgrepBinary.Service).filepath
          for (const pattern of ["**/[abc", "{a,b", "a}b", "\\"]) {
            const invalid = yield* Effect.promise(() => rejects(rg, tmp.path, pattern))
            const result = yield* run({ cwd: tmp.path, pattern })
            expect({ pattern, invalid: result.invalidPattern === true }).toEqual({ pattern, invalid })
            if (invalid) expect(result.paths).toEqual([])
          }
          expect(yield* Effect.promise(() => rejects(rg, tmp.path, "**/[abc"))).toBe(true)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("leaves negated patterns to ripgrep", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => seed(tmp.path))
          const rg = yield* (yield* RipgrepBinary.Service).filepath
          const before = yield* Effect.promise(() => list(rg, tmp.path, ["--glob=!*.ts"]))
          expect((yield* run({ cwd: tmp.path, pattern: "!*.ts" })).paths).toEqual(before.sort())
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
