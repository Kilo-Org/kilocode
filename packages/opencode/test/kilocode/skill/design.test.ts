import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Skill } from "../../../src/skill"
import { provideInstance, provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.mergeAll(Skill.defaultLayer, CrossSpawnSpawner.defaultLayer))

const found = (list: Skill.Info[]) => list.find((item) => item.name === "project-design")

describe("DESIGN.md skill", () => {
  it.live("exposes root DESIGN.md as a project design skill", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, "DESIGN.md"),
              "# Product Design\n\nUse warm neutrals, serif headings, and generous spacing.",
            ),
          )

          const skill = yield* Skill.Service
          const item = found(yield* skill.all())
          expect(item).toBeDefined()
          expect(item!.description).toBe(
            "Use this when creating or modifying UI so visual choices follow the project's DESIGN.md design system, including colors, typography, layout, components, and style guardrails.",
          )
          expect(item!.location).toBe(path.join(dir, "DESIGN.md"))
          expect(item!.content).toContain("DESIGN.md is the project's design-system source of truth for UI work.")
          expect(item!.content).toContain("Design tokens are exact values to follow; prose explains how to apply them.")
          expect(item!.content).toContain("Use existing tokens, components, and guardrails before inventing new visual rules.")
          expect(item!.content).toContain("Use warm neutrals")
        }),
      { git: true },
    ),
  )

  it.live("prefers the nearest ancestor DESIGN.md", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const pkg = path.join(dir, "packages", "web")
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(path.join(dir, "DESIGN.md"), "# Root Design\n\nUse root styles."),
              Bun.write(path.join(pkg, "DESIGN.md"), "# Web Design\n\nUse package styles."),
            ]),
          )

          yield* Effect.gen(function* () {
            const skill = yield* Skill.Service
            const item = found(yield* skill.all())
            expect(item).toBeDefined()
            expect(item!.location).toBe(path.join(pkg, "DESIGN.md"))
            expect(item!.content).toContain("Use package styles")
          }).pipe(provideInstance(pkg))
        }),
      { git: true },
    ),
  )

  it.live("uses conventional documentation fallback locations", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(path.join(dir, "docs", "design-system", "DESIGN.md"), "# Docs Design\n\nUse docs styles."),
          )

          const skill = yield* Skill.Service
          const item = found(yield* skill.all())
          expect(item).toBeDefined()
          expect(item!.location).toBe(path.join(dir, "docs", "design-system", "DESIGN.md"))
          expect(item!.content).toContain("Use docs styles")
        }),
      { git: true },
    ),
  )

  it.live("does not add project-design when DESIGN.md is absent", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          expect(found(yield* skill.all())).toBeUndefined()
        }),
      { git: true },
    ),
  )

  it.live("lets explicit project-design skills override DESIGN.md", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(path.join(dir, "DESIGN.md"), "# Product Design\n\nUse file styles."),
              Bun.write(
                path.join(dir, ".kilo", "skill", "project-design", "SKILL.md"),
                `---
name: project-design
description: Explicit design skill.
---

# Explicit Design

Use explicit skill content.
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const item = found(yield* skill.all())
          expect(item).toBeDefined()
          expect(item!.description).toBe("Explicit design skill.")
          expect(item!.location).toContain(path.join("skill", "project-design", "SKILL.md"))
          expect(item!.content).toContain("Use explicit skill content")
        }),
      { git: true },
    ),
  )
})
