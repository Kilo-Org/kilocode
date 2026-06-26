import path from "node:path"
import { describe, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Effect, Layer } from "effect"
import { HttpClient } from "effect/unstable/http"
import { MAX_ARCHIVE_ENTRIES, Marketplace, SkillArchive, decodeManifest } from "@/kilocode/marketplace"
import { testEffect } from "../../lib/effect"
import { archive, skillArchive, skillManifest } from "./fixture"

const http = HttpClient.make((request) => Effect.die(`unexpected HTTP request: ${request.url}`))
const layer = Layer.mergeAll(
  AppFileSystem.defaultLayer,
  EffectFlock.defaultLayer,
  Layer.succeed(HttpClient.HttpClient, http),
)
const it = testEffect(layer)

describe("Marketplace Skill archives", () => {
  it.live("extracts a verified root SKILL.md with nested regular files", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      const destination = path.join(root, "stage")
      const result = yield* SkillArchive.extract({ id: "demo-skill", bytes: skillArchive(), destination })
      expect(result.skill).toBe(path.join(destination, "SKILL.md"))
      expect(yield* fs.readFileString(path.join(destination, "references", "example.txt"))).toBe("reference")
    }),
  )

  it.live("extracts a historical archive wrapped in the Skill ID directory", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      const destination = path.join(root, "stage")
      const bytes = archive([
        { name: "demo-skill", type: "5" },
        { name: "demo-skill/SKILL.md", content: "---\nname: demo-skill\n---\n\nInstructions.\n" },
        { name: "demo-skill/references", type: "5" },
        { name: "demo-skill/references/example.txt", content: "reference" },
      ])

      const result = yield* SkillArchive.extract({ id: "demo-skill", bytes, destination })
      expect(result.skill).toBe(path.join(destination, "SKILL.md"))
      expect(yield* fs.readFileString(path.join(destination, "references", "example.txt"))).toBe("reference")
      expect(yield* fs.existsSafe(path.join(destination, "demo-skill"))).toBe(false)
    }),
  )

  it.live("rejects traversal paths before writing outside staging", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      const error = yield* Effect.flip(
        SkillArchive.extract({
          id: "demo-skill",
          bytes: archive([{ name: "../escape.txt", content: "escaped" }]),
          destination: path.join(root, "stage"),
        }),
      )
      expect(error.reason).toBe("unsafe_path")
      expect(yield* fs.existsSafe(path.join(root, "escape.txt"))).toBe(false)
    }),
  )

  it.live("rejects absolute and platform-specific unsafe paths", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      for (const name of ["/absolute.txt", "C:/drive.txt", "folder/NUL.txt"]) {
        const error = yield* Effect.flip(
          SkillArchive.extract({
            id: "demo-skill",
            bytes: archive([{ name, content: "escaped" }]),
            destination: path.join(root, name.replaceAll(/[^A-Za-z]/g, "-")),
          }),
        )
        expect(error.reason).toBe("unsafe_path")
      }
    }),
  )

  it.live("rejects archives with bomb-like entry counts", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      const entries = Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, (_, index) => ({
        name: `files/${index}.txt`,
        content: "",
      }))
      const error = yield* Effect.flip(
        SkillArchive.extract({
          id: "demo-skill",
          bytes: archive(entries),
          destination: path.join(root, "stage"),
        }),
      )
      expect(error.reason).toBe("too_many_entries")
    }),
  )

  it.live("rejects symlinks and unsupported archive entry types", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      const error = yield* Effect.flip(
        SkillArchive.extract({
          id: "demo-skill",
          bytes: archive([{ name: "SKILL.md", type: "2", link: "../../outside" }]),
          destination: path.join(root, "stage"),
        }),
      )
      expect(error.reason).toBe("link")
    }),
  )

  it.live("requires a valid root SKILL.md whose name matches the Marketplace ID", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      const missing = yield* Effect.flip(
        SkillArchive.extract({
          id: "demo-skill",
          bytes: archive([{ name: "README.md", content: "read me" }]),
          destination: path.join(root, "missing"),
        }),
      )
      expect(missing.reason).toBe("missing_skill")

      const invalid = yield* Effect.flip(
        SkillArchive.extract({
          id: "demo-skill",
          bytes: archive([{ name: "SKILL.md", content: "---\nname: another-skill\n---\n\nInstructions.\n" }]),
          destination: path.join(root, "invalid"),
        }),
      )
      expect(invalid.reason).toBe("invalid_skill")
    }),
  )

  it.live("stages and atomically installs only into the project .kilo/skills directory", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const project = yield* fs.makeTempDirectoryScoped()
      const bytes = skillArchive()
      const decoded = yield* decodeManifest(skillManifest(bytes))
      const item = decoded.items[0]
      if (item.kind !== "skill") return yield* Effect.die("expected Skill fixture")

      const installed = yield* Effect.gen(function* () {
        const marketplace = yield* Marketplace.Service
        const staged = yield* marketplace.stageSkillArchive({ project, item, bytes })
        return yield* marketplace.commitSkill(staged)
      }).pipe(Effect.scoped, Effect.provide(Marketplace.layer({ cacheDir: path.join(project, "cache") })))

      expect(installed.path).toBe(path.join(project, ".kilo", "skills", "demo-skill"))
      expect(yield* fs.isFile(installed.skill)).toBe(true)

      const duplicate = yield* Effect.flip(
        Effect.gen(function* () {
          const marketplace = yield* Marketplace.Service
          return yield* marketplace.stageSkillArchive({ project, item, bytes })
        }).pipe(Effect.scoped, Effect.provide(Marketplace.layer({ cacheDir: path.join(project, "cache") }))),
      )
      expect(duplicate._tag).toBe("SkillInstallError")
      expect(duplicate.reason).toBe("already_installed")
    }),
  )

  it.live("rejects project Skill roots that resolve through an escaping symlink", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const project = yield* fs.makeTempDirectoryScoped()
      const outside = yield* fs.makeTempDirectoryScoped()
      yield* fs.symlink(outside, path.join(project, ".kilo"))
      const bytes = skillArchive()
      const decoded = yield* decodeManifest(skillManifest(bytes))
      const item = decoded.items[0]
      if (item.kind !== "skill") return yield* Effect.die("expected Skill fixture")

      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const marketplace = yield* Marketplace.Service
          return yield* marketplace.stageSkillArchive({ project, item, bytes })
        }).pipe(Effect.scoped, Effect.provide(Marketplace.layer({ cacheDir: path.join(project, "cache") }))),
      )
      expect(error._tag).toBe("SkillInstallError")
      expect(error.reason).toBe("unsafe_destination")
    }),
  )
})
