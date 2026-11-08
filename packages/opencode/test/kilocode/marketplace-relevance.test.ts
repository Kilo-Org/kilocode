import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import * as MarketplaceRelevance from "../../src/kilocode/marketplace/relevance"
import type { MarketplaceItem } from "../../src/kilocode/marketplace/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, Ripgrep.node])))

function item(id: string, filename: string[]) {
  return {
    type: "agent",
    id,
    name: id,
    description: id,
    category: "development",
    content: { mode: "all", description: id, prompt: id },
    suggest_for: { filename },
  } as unknown as MarketplaceItem
}

const write = (dir: string, files: Record<string, string>) =>
  Effect.promise(async () => {
    for (const [file, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true })
      await Bun.write(path.join(dir, file), text)
    }
  })

describe("marketplace relevance", () => {
  it.live("finds patterns in tracked files and skips gitignored files", () =>
    Effect.gen(function* () {
      const ripgrep = yield* Ripgrep.Service
      const dir = yield* tmpdirScoped({ git: true })
      yield* write(dir, {
        ".gitignore": "data/\n",
        "notebooks/analysis.ipynb": "{}",
        "src/a.component.ts": "",
        "src/b.component.ts": "",
        "src/c.component.ts": "",
        "data/cache.duckdb": "",
      })

      const found = yield* MarketplaceRelevance.detect({
        ripgrep,
        directory: dir,
        items: [item("data", ["*.ipynb", "*.duckdb"]), item("angular", ["*.component.ts"]), item("rust", ["*.rs"])],
      })

      expect(found.toSorted()).toEqual(["*.component.ts", "*.ipynb"])
    }),
  )

  it.live("keeps other patterns working next to a brace pattern", () =>
    Effect.gen(function* () {
      const ripgrep = yield* Ripgrep.Service
      const dir = yield* tmpdirScoped({ git: true })
      yield* write(dir, { "config.yaml": "", "main.go": "" })

      const found = yield* MarketplaceRelevance.detect({
        ripgrep,
        directory: dir,
        items: [item("yaml", ["*.{yml,yaml}"]), item("go", ["*.go"])],
      })

      expect(found.toSorted()).toEqual(["*.go", "*.{yml,yaml}"])
    }),
  )

  it.live("honors ignore files outside a git repository", () =>
    Effect.gen(function* () {
      const ripgrep = yield* Ripgrep.Service
      const dir = yield* tmpdirScoped({})
      yield* write(dir, {
        ".gitignore": "data/\n",
        "notebooks/a.ipynb": "{}",
        "data/cache.duckdb": "",
      })

      const found = yield* MarketplaceRelevance.detect({
        ripgrep,
        directory: dir,
        items: [item("data", ["*.ipynb", "*.duckdb"])],
      })

      expect(found).toEqual(["*.ipynb"])
    }),
  )

  it.live("skips build directories without a .gitignore", () =>
    Effect.gen(function* () {
      const ripgrep = yield* Ripgrep.Service
      const dir = yield* tmpdirScoped({})
      yield* write(dir, { "node_modules/pkg/a.duckdb": "", "build/b.duckdb": "" })

      const found = yield* MarketplaceRelevance.detect({ ripgrep, directory: dir, items: [item("data", ["*.duckdb"])] })

      expect(found).toEqual([])
    }),
  )

  it.live("keeps valid patterns when one pattern is malformed", () =>
    Effect.gen(function* () {
      const ripgrep = yield* Ripgrep.Service
      const dir = yield* tmpdirScoped({})
      yield* write(dir, { "notebooks/a.ipynb": "{}" })

      const found = yield* MarketplaceRelevance.detect({
        ripgrep,
        directory: dir,
        items: [item("broken", ["*.["]), item("jupyter", ["*.ipynb"])],
      })

      expect(found).toEqual(["*.ipynb"])
    }),
  )

  it.live("does not fan out per pattern on a transient ripgrep error", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({})
      const calls: string[] = []
      // A transient error (for example an unreadable directory) sets partial without
      // invalidPattern. Real ripgrep cannot produce this deterministically, so stub it.
      const ripgrep = {
        glob: (input: { pattern: string }) => {
          calls.push(input.pattern)
          return Effect.succeed({ items: [], truncated: false, partial: true })
        },
      } as unknown as Ripgrep.Interface

      const found = yield* MarketplaceRelevance.detect({
        ripgrep,
        directory: dir,
        items: [item("a", ["*.ipynb"]), item("b", ["*.duckdb"])],
      })

      expect(found).toEqual([])
      expect(calls).toHaveLength(1)
    }),
  )
})
