import { describe, expect, spyOn } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { Cause, Effect, Exit, Fiber } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { parse } from "jsonc-parser"
import * as Companions from "../../src/kilocode/marketplace/companions"
import * as Paths from "../../src/kilocode/marketplace/paths"
import { install, remove } from "../../src/kilocode/marketplace/installer"
import { OWNER, stageSkill } from "../../src/kilocode/marketplace/skill-archive"
import { Process } from "../../src/util/process"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const entry = { type: "local", command: ["node", "server.js"] }

function input(directory: string) {
  return { scope: "project" as const, directory, worktree: directory }
}

function services(directory: string) {
  // File-backed installs only invalidate Config. The archive, config, receipts,
  // locks, and cleanup operations below all use their real implementations.
  return { directory, worktree: directory, config: { invalidate: () => Effect.void } } as Parameters<typeof install>[0]
}

async function archive(id = "guide", files: Record<string, string> = {}) {
  const bytes = await new Bun.Archive(
    { [`${id}/SKILL.md`]: `---\nname: ${id}\ndescription: Companion workflow\n---\n\nUse the MCP.\n`, ...files },
    { compress: "gzip" },
  ).bytes()
  return { id, content: `data:application/gzip;base64,${Buffer.from(bytes).toString("base64")}` }
}

async function exists(file: string) {
  return fs.lstat(file).then(
    () => true,
    (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return false
      throw err
    },
  )
}

describe("marketplace MCP companions", () => {
  it.live("installs local MCPs with durable ownership and preserves unrelated JSONC", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const ctx = input(tmp)
      const file = path.join(tmp, ".kilo", "kilo.jsonc")
      yield* Effect.promise(() =>
        Bun.write(file, '// user comment\n{"model":"kept","mcp":{"other":{"enabled":false}}}'),
      )
      const skill = yield* Effect.promise(() => archive())
      const files = yield* Companions.install(ctx, "server", [skill], entry)
      const receipt = yield* Effect.promise(() => Companions.read("project", tmp, "server"))
      expect(receipt?.skills).toEqual(["guide"])
      expect(files).toEqual([file, path.join(tmp, ".kilo", "skills", "guide", "SKILL.md")])
      const text = yield* Effect.promise(() => Bun.file(file).text())
      expect(text).toContain("// user comment")
      expect(parse(text)).toEqual({ model: "kept", mcp: { other: { enabled: false }, server: entry } })
      expect(yield* Effect.promise(() => Bun.file(path.join(path.dirname(files.at(1)!), OWNER)).json())).toEqual({
        version: 1,
        id: "server",
        token: receipt!.token,
      })
      yield* Companions.remove(ctx, receipt!)
      yield* Companions.remove(ctx, receipt!)
      expect(yield* Effect.promise(() => Companions.read("project", tmp, "server"))).toBeUndefined()
      expect(yield* Effect.promise(() => exists(path.dirname(files.at(1)!)))).toBe(false)
      expect(parse(yield* Effect.promise(() => Bun.file(file).text()))).toEqual({
        model: "kept",
        mcp: { other: { enabled: false } },
      })
    }),
  )

  it.live("keeps nested-project ownership local when the selected config is in an ancestor", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const dir = path.join(tmp, "nested")
      const file = path.join(tmp, ".kilo", "kilo.jsonc")
      yield* Effect.promise(() => fs.mkdir(dir))
      yield* Effect.promise(() => Bun.write(file, '{"model":"keep"}'))
      const ctx = { ...input(dir), worktree: tmp }
      const skill = yield* Effect.promise(() => archive())
      const files = yield* Companions.install(ctx, "server", [skill], entry)
      expect(files).toEqual([file, path.join(dir, ".kilo", "skills", "guide", "SKILL.md")])
      // The receipt is anchored to the config root, so the bundle stays removable
      // from either the install directory or the directory that owns the config.
      const fromRoot = yield* Effect.promise(() => Companions.read("project", tmp, "server"))
      const fromNested = yield* Effect.promise(() => Companions.read("project", dir, "server", tmp))
      expect(fromRoot?.id).toBe("server")
      expect(fromNested?.token).toBe(fromRoot?.token)
      // Removing from the config root must still find and remove the nested skill.
      yield* Companions.remove({ scope: "project", directory: tmp, worktree: tmp }, fromRoot!)
      expect(parse(yield* Effect.promise(() => Bun.file(file).text())).model).toBe("keep")
      expect(parse(yield* Effect.promise(() => Bun.file(file).text())).mcp?.server).toBeUndefined()
      expect(yield* Effect.promise(() => exists(path.join(dir, ".kilo", "skills", "guide")))).toBe(false)
      expect(yield* Effect.promise(() => Companions.read("project", tmp, "server"))).toBeUndefined()
    }),
  )

  it.live("preserves a pre-existing MCP entry in another config layer on removal", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const dir = path.join(tmp, "nested")
      const ancestor = path.join(tmp, "kilo.json")
      const target = path.join(tmp, ".kilo", "kilo.jsonc")
      yield* Effect.promise(() => fs.mkdir(dir))
      yield* Effect.promise(() => fs.mkdir(path.join(tmp, ".kilo")))
      // The selected install target is a distinct layer from the root config.
      yield* Effect.promise(() => Bun.write(target, '{"model":"keep"}'))
      // A root-level config already defines the same MCP id in a different layer.
      yield* Effect.promise(() =>
        Bun.write(ancestor, '{"mcp":{"server":{"type":"remote","url":"https://existing.example"}}}'),
      )
      const ctx = { ...input(dir), worktree: tmp }
      const skill = yield* Effect.promise(() => archive())
      yield* Companions.install(ctx, "server", [skill], entry)
      const receipt = (yield* Effect.promise(() => Companions.read("project", dir, "server", tmp)))!
      yield* Companions.remove(ctx, receipt)
      // Only the install target changes; the pre-existing root definition survives.
      expect(parse(yield* Effect.promise(() => Bun.file(ancestor).text())).mcp.server).toEqual({
        type: "remote",
        url: "https://existing.example",
      })
      expect(parse(yield* Effect.promise(() => Bun.file(target).text())).mcp?.server).toBeUndefined()
      expect(yield* Effect.promise(() => exists(path.join(dir, ".kilo", "skills", "guide")))).toBe(false)
    }),
  )

  it.live("rejects non-YAML frontmatter without executing it", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = globalThis as { __marketplaceFrontmatter?: boolean }
      delete global.__marketplaceFrontmatter
      const skill = yield* Effect.promise(() =>
        archive("guide", {
          "guide/SKILL.md":
            '---javascript\n(globalThis.__marketplaceFrontmatter = true, {name: "guide", description: "Valid"})\n---\nBody',
        }),
      )
      const out = yield* Companions.install(input(tmp), "server", [skill], entry).pipe(Effect.exit)
      expect(Exit.isFailure(out)).toBe(true)
      expect(global.__marketplaceFrontmatter).toBeUndefined()
      expect(yield* Effect.promise(() => exists(Paths.skillsDir("project", tmp)))).toBe(false)
    }),
  )

  for (const ids of [["../guide"], ["guide", "guide"], ["guide", "GUIDE"], [".hidden"], ["constructor"]]) {
    it.live(`rejects unsafe or duplicate ids: ${ids.join(", ")}`, () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const skills = ids.map((id) => ({ id, content: "not downloaded" }))
        const out = yield* Companions.install(input(tmp), "server", skills, entry).pipe(Effect.exit)
        expect(Exit.isFailure(out)).toBe(true)
        expect(yield* Effect.promise(() => exists(path.join(tmp, ".kilo")))).toBe(false)
      }),
    )
  }

  for (const front of [
    "name: different\ndescription: Valid",
    "name: guide",
    "name: guide\ndescription: ''",
    "name: [",
  ]) {
    it.live(`rejects undiscoverable frontmatter: ${front}`, () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const skill = yield* Effect.promise(() => archive("guide", { "guide/SKILL.md": `---\n${front}\n---\nBody` }))
        const out = yield* Companions.install(input(tmp), "server", [skill], entry).pipe(Effect.exit)
        expect(Exit.isFailure(out)).toBe(true)
        expect(yield* Effect.promise(() => exists(Paths.skillsDir("project", tmp)))).toBe(false)
        expect(yield* Effect.promise(() => Companions.read("project", tmp, "server"))).toBeUndefined()
      }),
    )
  }

  for (const name of [
    "guide/../outside",
    "/guide/outside",
    "guide/sub/../../outside",
    `guide/${OWNER}`,
    "guide/x\\evil",
  ]) {
    it.live(`rejects unsafe archive entry before extraction: ${name}`, () =>
      Effect.gen(function* () {
        // Windows treats a backslash as a path separator, so that entry is a
        // valid nested path there and is not a traversal.
        if (process.platform === "win32" && name.includes("\\")) return
        const tmp = yield* tmpdirScoped()
        const skill = yield* Effect.promise(() => archive("guide", { [name]: "untrusted" }))
        const out = yield* Companions.install(input(tmp), "server", [skill], entry).pipe(Effect.exit)
        expect(Exit.isFailure(out)).toBe(true)
        expect(yield* Effect.promise(() => exists(Paths.skillsDir("project", tmp)))).toBe(false)
        expect(yield* Effect.promise(() => exists(path.join(tmp, "outside")))).toBe(false)
      }),
    )
  }

  for (const link of ["symlink", "hardlink"] as const) {
    it.live(`rejects ${link} archive entries before extraction`, () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const dir = path.join(tmp, "source")
        yield* Effect.promise(() =>
          Bun.write(path.join(dir, "SKILL.md"), "---\nname: guide\ndescription: Valid\n---\n"),
        )
        yield* Effect.promise(() =>
          link === "symlink"
            ? fs.symlink("SKILL.md", path.join(dir, "link"))
            : fs.link(path.join(dir, "SKILL.md"), path.join(dir, "link")),
        )
        yield* Effect.promise(() => Process.run(["tar", "-czf", "skill.tar.gz", "source"], { cwd: tmp }))
        const bytes = yield* Effect.promise(() => Bun.file(path.join(tmp, "skill.tar.gz")).bytes())
        const out = yield* Companions.install(
          input(tmp),
          "server",
          [{ id: "guide", content: `data:application/gzip;base64,${Buffer.from(bytes).toString("base64")}` }],
          entry,
        ).pipe(Effect.exit)
        expect(Exit.isFailure(out)).toBe(true)
        if (Exit.isFailure(out)) expect(Cause.pretty(out.cause)).toContain("unsafe paths")
      }),
    )
  }

  for (const kind of ["empty", "symlink", "dangling"] as const) {
    it.live(`does not adopt or overwrite an existing ${kind} skill directory`, () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const base = Paths.skillsDir("project", tmp)
        const dir = path.join(base, "guide")
        yield* Effect.promise(() => fs.mkdir(base, { recursive: true }))
        yield* Effect.promise(() =>
          kind === "empty" ? fs.mkdir(dir) : fs.symlink(kind === "symlink" ? tmp : path.join(tmp, "missing"), dir),
        )
        const skill = yield* Effect.promise(() => archive())
        const out = yield* Companions.install(input(tmp), "server", [skill], entry).pipe(Effect.exit)
        expect(Exit.isFailure(out)).toBe(true)
        if (Exit.isFailure(out)) expect(Cause.pretty(out.cause)).toContain("already exists")
        expect(yield* Effect.promise(() => exists(dir))).toBe(true)
        expect(yield* Effect.promise(() => Companions.read("project", tmp, "server"))).toBeUndefined()
      }),
    )
  }

  for (const failure of ["receipt", "skill", "config"] as const) {
    it.live(`rolls back a failed ${failure} write without modifying the MCP config`, () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const ctx = input(tmp)
        const file = path.join(tmp, ".kilo", "kilo.jsonc")
        const original = '// keep exactly\n{"model":"kept"}\n'
        yield* Effect.promise(() => Bun.write(file, original))
        const skills = yield* Effect.promise(() => Promise.all([archive("first"), archive("second")]))
        const rename = fs.rename
        const link = fs.link
        const target =
          failure === "receipt"
            ? path.join(yield* Effect.promise(() => Paths.mcpsDir("project", tmp)), "server.json")
            : failure === "skill"
              ? path.join(Paths.skillsDir("project", tmp), "second")
              : file
        const probe =
          failure === "receipt"
            ? spyOn(fs, "link").mockImplementation(async (from, to) => {
                if (to === target) throw new Error("EACCES: test receipt write failed")
                return link(from, to)
              })
            : spyOn(fs, "rename").mockImplementation(async (from, to) => {
                if (to === target) throw new Error(`EACCES: test ${failure} write failed`)
                return rename(from, to)
              })
        try {
          const out = yield* Companions.install(ctx, "server", skills, entry).pipe(Effect.exit)
          expect(Exit.isFailure(out)).toBe(true)
          if (Exit.isFailure(out)) expect(Cause.pretty(out.cause)).toContain("EACCES")
        } finally {
          probe.mockRestore()
        }
        expect(yield* Effect.promise(() => Bun.file(file).text())).toBe(original)
        expect(yield* Effect.promise(() => Companions.read("project", tmp, "server"))).toBeUndefined()
        for (const skill of skills) {
          expect(yield* Effect.promise(() => exists(path.join(Paths.skillsDir("project", tmp), skill.id)))).toBe(false)
        }
        yield* Companions.install(ctx, "server", skills, entry)
        expect(yield* Effect.promise(() => Companions.read("project", tmp, "server"))).toBeDefined()
      }),
    )
  }

  it.live("retains the receipt on partial removal and does not delete a replacement on retry", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const ctx = input(tmp)
      const skill = yield* Effect.promise(() => archive())
      yield* Companions.install(ctx, "server", [skill], entry)
      const receipt = (yield* Effect.promise(() => Companions.read("project", tmp, "server")))!
      const trash = path.join(tmp, ".kilo", "marketplace", "staging", receipt.token, "guide")
      const original = fs.rm
      const probe = spyOn(fs, "rm").mockImplementation(async (file, opts) => {
        if (file === trash && (await exists(file))) {
          await original(path.join(trash, OWNER), { force: true })
          throw new Error("EACCES: partial removal")
        }
        return original(file, opts)
      })
      try {
        const out = yield* Companions.remove(ctx, receipt).pipe(Effect.exit)
        expect(Exit.isFailure(out)).toBe(true)
      } finally {
        probe.mockRestore()
      }
      expect((yield* Effect.promise(() => Companions.read("project", tmp, "server")))?.token).toBe(receipt.token)
      const file = yield* Effect.promise(() => Paths.configPath("project", tmp, tmp))
      expect(parse(yield* Effect.promise(() => Bun.file(file).text())).mcp.server).toBeUndefined()
      expect((yield* install(services(tmp), { item: { type: "skill", ...skill } })).success).toBe(true)
      yield* Companions.remove(ctx, receipt)
      expect(
        yield* Effect.promise(() => Bun.file(path.join(Paths.skillsDir("project", tmp), "guide", "SKILL.md")).text()),
      ).toContain("Use the MCP")
      expect(yield* Effect.promise(() => exists(trash))).toBe(false)
      expect(yield* Effect.promise(() => Companions.read("project", tmp, "server"))).toBeUndefined()
    }),
  )

  it.live("keeps the receipt if rollback fails so removal can recover without a catalog", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const ctx = input(tmp)
      const file = path.join(tmp, ".kilo", "kilo.jsonc")
      const skill = yield* Effect.promise(() => archive())
      const rename = fs.rename
      const probe = spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (
          to === file ||
          (String(from).includes(`${path.sep}skills${path.sep}`) &&
            String(to).includes(`${path.sep}staging${path.sep}`))
        ) {
          throw new Error("EACCES: write and rollback denied")
        }
        return rename(from, to)
      })
      try {
        const out = yield* install(services(tmp), {
          item: { type: "mcp", id: "server", content: JSON.stringify(entry), skills: [skill] },
        })
        expect(out.success).toBe(false)
        expect(out.error).toContain("cleanup incomplete")
        expect(out.error).toContain("EACCES: write and rollback denied")
        expect(out.error).not.toContain("UnknownError")
        expect(out.error).not.toContain(" at ")
      } finally {
        probe.mockRestore()
      }
      const receipt = yield* Effect.promise(() => Companions.read("project", tmp, "server"))
      expect(receipt).toBeDefined()
      expect(yield* Effect.promise(() => exists(file))).toBe(false)
      yield* Companions.remove(ctx, receipt!)
      expect(yield* Effect.promise(() => exists(path.join(Paths.skillsDir("project", tmp), "guide")))).toBe(false)
    }),
  )

  it.live("does not follow scope symlinks or accept receipt path traversal", () =>
    Effect.gen(function* () {
      // Creating and removing directory symlinks on Windows needs privileges,
      // and the scope-escape check is POSIX-specific.
      if (process.platform === "win32") return
      const tmp = yield* tmpdirScoped()
      const outside = yield* tmpdirScoped()
      yield* Effect.promise(() => fs.symlink(outside, path.join(tmp, ".kilo")))
      const skill = yield* Effect.promise(() => archive())
      expect(Exit.isFailure(yield* Companions.install(input(tmp), "server", [skill], entry).pipe(Effect.exit))).toBe(
        true,
      )
      expect(yield* Effect.promise(() => fs.readdir(outside))).toEqual([])
      yield* Effect.promise(() => fs.rm(path.join(tmp, ".kilo")))
      yield* Companions.install(input(tmp), "server", [skill], entry)
      const receipt = (yield* Effect.promise(() => Companions.read("project", tmp, "server")))!
      const receipts = yield* Effect.promise(() => Paths.mcpsDir("project", tmp))
      yield* Effect.promise(() =>
        Bun.write(path.join(receipts, "server.json"), JSON.stringify({ ...receipt, skills: ["../outside"] })),
      )
      const out = yield* remove(services(tmp), { id: "server", type: "mcp" }, "project")
      expect(out.success).toBe(false)
      expect(yield* Effect.promise(() => exists(path.join(Paths.skillsDir("project", tmp), "guide", "SKILL.md")))).toBe(
        true,
      )
    }),
  )

  it.live("serializes competing MCP bundles that claim the same skill", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const skill = yield* Effect.promise(() => archive())
      const svc = services(tmp)
      const out = yield* Effect.all(
        ["first", "second"].map((id) =>
          install(svc, { item: { type: "mcp", id, content: JSON.stringify(entry), skills: [skill] } }),
        ),
        { concurrency: "unbounded" },
      )
      expect(out.filter((item) => item.success)).toHaveLength(1)
      const winner = out.find((item) => item.success)!.slug
      expect((yield* Effect.promise(() => Companions.read("project", tmp, winner)))?.skills).toEqual(["guide"])
      const file = yield* Effect.promise(() => Paths.configPath("project", tmp, tmp))
      expect(Object.keys(parse(yield* Effect.promise(() => Bun.file(file).text())).mcp)).toEqual([winner])
    }),
  )

  it.live("cleans staged archives on interruption before committing the MCP", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const reached = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const bytes = yield* Effect.promise(() =>
        new Bun.Archive(
          { "guide/SKILL.md": "---\nname: guide\ndescription: Valid\n---\n" },
          { compress: "gzip" },
        ).bytes(),
      )
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch() {
          reached.resolve()
          await release.promise
          return new Response(bytes)
        },
      })
      try {
        const fiber = yield* Companions.install(
          input(tmp),
          "server",
          [{ id: "guide", content: server.url.href }],
          entry,
        ).pipe(Effect.forkChild)
        yield* Effect.promise(() => reached.promise)
        fiber.interruptUnsafe()
        release.resolve()
        expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true)
        expect(yield* Effect.promise(() => exists(Paths.skillsDir("project", tmp)))).toBe(false)
        expect(yield* Effect.promise(() => Companions.read("project", tmp, "server"))).toBeUndefined()
      } finally {
        release.resolve()
        yield* Effect.promise(() => server.stop(true))
      }
    }),
  )

  it.live("standalone archives cannot forge companion ownership", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const skill = yield* Effect.promise(() => archive("guide", { [`guide/${OWNER}`]: "{}" }))
      const out = yield* Effect.tryPromise(() => stageSkill(skill, tmp)).pipe(Effect.exit)
      expect(Exit.isFailure(out)).toBe(true)
      if (Exit.isFailure(out)) expect(Cause.pretty(out.cause)).toContain("ownership metadata")
    }),
  )

  it.live("returns the archive download error without Effect wrappers or stack traces", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => new Response("missing", { status: 404 }),
      })
      try {
        const out = yield* install(services(tmp), {
          item: {
            type: "mcp",
            id: "server",
            content: JSON.stringify(entry),
            skills: [{ id: "guide", content: server.url.href }],
          },
        })
        expect(out).toEqual({ success: false, slug: "server", error: "Download failed: 404" })
        expect(out.error).not.toContain("UnknownError")
        expect(out.error).not.toContain(" at ")
        expect(yield* Effect.promise(() => exists(Paths.skillsDir("project", tmp)))).toBe(false)
      } finally {
        yield* Effect.promise(() => server.stop(true))
      }
    }),
  )
})
