import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Glob } from "@opencode-ai/core/util/glob"
import { expect, spyOn } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { Skill } from "../../src/skill"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(Skill.node), AppNodeBuilder.build(CrossSpawnSpawner.node)))

const body = (name: string, description: string) => `---
name: ${name}
description: ${description}
---

# ${name}
`

// Force every scan into descending path order. Without a sort inside scan(),
// the last returned path wins, so this makes the lexicographically first copy win.
const descend = () => {
  const real = Glob.scan
  return spyOn(Glob, "scan").mockImplementation(async (pattern, opts) => {
    const found = await real(pattern, opts)
    return found.toSorted().toReversed()
  })
}

it.instance(
  "resolves duplicate skill names independently of glob order",
  () =>
    Effect.gen(function* () {
      const spy = descend()
      yield* Effect.addFinalizer(() => Effect.sync(() => spy.mockRestore()))

      const root = (yield* TestInstance).directory
      const file = (rel: string) => path.join(root, ...rel.split("/"))
      const write = (rel: string, name: string, description: string) =>
        Effect.promise(() => Bun.write(file(rel), body(name, description)))

      yield* write(".claude/skills/synced/m/sheet/SKILL.md", "sheet", "from-m")
      yield* write(".claude/skills/synced/z/sheet/SKILL.md", "sheet", "from-z")
      yield* write(".claude/skills/synced/m/overlap/SKILL.md", "overlap", "claude-m")
      yield* write(".claude/skills/synced/z/overlap/SKILL.md", "overlap", "claude-z")
      yield* write(".agents/skills/a/overlap/SKILL.md", "overlap", "agents-a")

      const svc = yield* Skill.Service
      const sheet = yield* svc.get("sheet")
      const overlap = yield* svc.get("overlap")
      const prompt = Skill.fmt(yield* svc.available(), { verbose: true })

      // Same root: the later path in sorted order wins, even when glob returns the reverse.
      expect(sheet?.description).toBe("from-z")
      expect(sheet?.location).toBe(file(".claude/skills/synced/z/sheet/SKILL.md"))
      expect(prompt).toContain(`<location>${file(".claude/skills/synced/z/sheet/SKILL.md")}</location>`)
      expect(prompt).not.toContain(file(".claude/skills/synced/m/sheet/SKILL.md"))

      // Later roots still override earlier ones, even when their path sorts first.
      expect(overlap?.description).toBe("agents-a")
      expect(overlap?.location).toBe(file(".agents/skills/a/overlap/SKILL.md"))
      expect(prompt).toContain(`<location>${file(".agents/skills/a/overlap/SKILL.md")}</location>`)
    }),
  { git: true },
)
