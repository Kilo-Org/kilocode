// kilocode_change - new file

/**
 * Unit tests for the docs-sync surface map and reviewer ranking.
 *
 * Fixtures are created in a temp dir at runtime (no committed fixtures) so the
 * tests prove the map is data-driven rather than baked into code.
 * Run: node .github/docs-sync/surfaces.test.mjs
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test, { after } from "node:test"

import {
  SURFACE_MAP_PATH,
  OTHER,
  loadSurfaceMap,
  surfaceNames,
  surfaceForDoc,
  surfaceForSource,
  surfaceDocPrefixes,
  surfaceSourcePrefixes,
  surfaceReviewers,
  otherDocPrefixes,
  derivation,
  groupBySurface,
} from "./surfaces.mjs"
import { rankContributors, computeSurfaceReviewers } from "./reviewers.mjs"

const temps = []

function writeMap(map) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-sync-surfaces-"))
  temps.push(dir)
  const file = path.join(dir, "surfaces.json")
  fs.writeFileSync(file, JSON.stringify(map, null, 2))
  return file
}

after(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const map = loadSurfaceMap()
const NOW = Date.parse("2026-06-01T00:00:00Z")
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString()

test("committed map is well formed", () => {
  assert.ok(fs.existsSync(SURFACE_MAP_PATH))
  assert.equal(path.basename(SURFACE_MAP_PATH), "surfaces.json")
  assert.ok(derivation(map).length > 0)
  assert.equal(surfaceNames(map).at(-1), OTHER)
  assert.deepEqual(surfaceNames(map), ["cli", "vscode", "jetbrains", "gateway", "web", "other"])
  assert.deepEqual(surfaceReviewers(OTHER, map), ["lambertjosh", "intentionally-left-nil"])
})

test("every configured prefix resolves to exactly its own surface", () => {
  for (const surface of map.surfaces) {
    for (const prefix of surfaceDocPrefixes(surface.name, map)) {
      assert.equal(surfaceForDoc(`${prefix}index.md`, map), surface.name, `doc ${prefix}`)
      assert.equal(surfaceForDoc(`${prefix}nested/deep.md`, map), surface.name, `doc ${prefix}`)
    }
    for (const prefix of surfaceSourcePrefixes(surface.name, map)) {
      assert.equal(surfaceForSource(`${prefix}src/index.ts`, map), surface.name, `source ${prefix}`)
    }
  }
})

test("platform pages route to the matching extension surface", () => {
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/code-with-ai/platforms/vscode/index.md", map), "vscode")
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/code-with-ai/platforms/vscode/whats-new.md", map), "vscode")
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/code-with-ai/platforms/jetbrains.md", map), "jetbrains")
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/code-with-ai/platforms/cli.md", map), "cli")
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/code-with-ai/features/autocomplete.md", map), "cli")
  // Longest prefix wins: the specific platform prefix beats the broad cli one.
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/code-with-ai/platforms/vscode/nested/deep.md", map), "vscode")
})

test("unmatched doc and source paths fall to other", () => {
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/community/index.md", map), OTHER)
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/kiloclaw/index.md", map), OTHER)
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/contributing/index.md", map), OTHER)
  assert.equal(surfaceForDoc("packages/kilo-docs/LEARNINGS.md", map), OTHER)
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/never-seen/new.md", map), OTHER)
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/index.tsx", map), OTHER)
  assert.equal(surfaceForDoc("docs/jetbrains-vscode-settings-parity.md", map), OTHER)
  assert.equal(surfaceForSource("packages/kilo-telemetry/src/index.ts", map), OTHER)
  assert.equal(surfaceForDoc("README.md", map), OTHER)

  assert.ok(otherDocPrefixes(map).includes("packages/kilo-docs/pages/community/"))
  assert.ok(otherDocPrefixes(map).includes("docs/"))
})

test("the map is read from data: changing a prefix changes the answer", () => {
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/getting-started/index.md", map), "cli")

  const changed = structuredClone(map)
  const cli = changed.surfaces.find((s) => s.name === "cli")
  cli.docs = cli.docs.map((p) =>
    p === "packages/kilo-docs/pages/getting-started/" ? "packages/kilo-docs/pages/renamed/" : p,
  )
  const changedFile = loadSurfaceMap(writeMap(changed))
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/getting-started/index.md", changedFile), OTHER)
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/renamed/index.md", changedFile), "cli")

  const extended = structuredClone(map)
  extended.surfaces.push({
    name: "extra",
    sources: ["packages/kilo-extra/"],
    docs: ["packages/kilo-docs/pages/extra/"],
  })
  const extendedFile = loadSurfaceMap(writeMap(extended))
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/extra/index.md", extendedFile), "extra")
  assert.equal(surfaceForSource("packages/kilo-extra/src/index.ts", extendedFile), "extra")
  assert.equal(surfaceForDoc("packages/kilo-docs/pages/extra/index.md", map), OTHER)
})

test("groupBySurface partitions files with no duplicates in deterministic order", () => {
  const files = [
    "packages/kilo-docs/pages/community/index.md",
    "packages/kilo-docs/pages/gateway/index.md",
    "packages/kilo-docs/pages/getting-started/index.md",
    "packages/kilo-docs/pages/unknown/a.md",
  ]
  const groups = groupBySurface(files, map)
  assert.deepEqual([...groups.keys()], ["cli", "gateway", "other"])
  assert.deepEqual(groups.get("other"), [
    "packages/kilo-docs/pages/community/index.md",
    "packages/kilo-docs/pages/unknown/a.md",
  ])
  assert.deepEqual(groups.get("cli"), ["packages/kilo-docs/pages/getting-started/index.md"])
  const flat = [...groups.values()].flat()
  assert.equal(flat.length, files.length)
  assert.equal(new Set(flat).size, files.length)
})

test("rankContributors weights recent over old and applies the half-life", () => {
  const commits = [
    { login: "recent", type: "User", date: daysAgo(10) },
    ...Array.from({ length: 4 }, () => ({ login: "old", type: "User", date: daysAgo(1500) })),
    { login: "dependabot[bot]", type: "Bot", date: daysAgo(1) },
    { login: "renovate-bot", type: "Bot", date: daysAgo(1) },
    { login: "human-bot[bot]", type: "User", date: daysAgo(1) },
  ]
  const ranked = rankContributors(commits, NOW)
  assert.deepEqual(
    ranked.map((r) => r.login),
    ["recent", "old"],
  )
  assert.equal(ranked[0].count, 1)
  assert.equal(ranked[1].count, 4)
  assert.ok(ranked[0].score > ranked[1].score)

  const fresh = rankContributors([{ login: "x", type: "User", date: daysAgo(0) }], NOW)
  assert.ok(Math.abs(fresh[0].score - 1) < 1e-9)
  const halved = rankContributors([{ login: "x", type: "User", date: daysAgo(180) }], NOW)
  assert.ok(Math.abs(halved[0].score - 0.5) < 1e-9)
  const faster = rankContributors([{ login: "x", type: "User", date: daysAgo(30) }], NOW, { halfLifeDays: 30 })
  assert.ok(Math.abs(faster[0].score - 0.5) < 1e-9)
})

test("rankContributors orders deterministically on score ties", () => {
  const ranked = rankContributors(
    [
      { login: "bob", type: "User", date: daysAgo(5) },
      { login: "alice", type: "User", date: daysAgo(5) },
      { login: "carol", type: "User", date: daysAgo(5) },
    ],
    NOW,
  )
  assert.deepEqual(
    ranked.map((r) => r.login),
    ["alice", "bob", "carol"],
  )
})

test("other reviewers are the fixed pair and never hit the API", async () => {
  let calls = 0
  const result = await computeSurfaceReviewers(OTHER, {
    api: async () => {
      calls++
      return []
    },
    repo: "acme/kilo",
    now: NOW,
    map,
  })
  assert.deepEqual(result.reviewers, ["lambertjosh", "intentionally-left-nil"])
  assert.equal(calls, 0)
  assert.deepEqual(result.sourcePrefixes, [])
  assert.match(result.note, /fixed reviewers/)
})

test("product-surface reviewers come from ranked commits that have write access", async () => {
  const seen = []
  const api = async (p) => {
    seen.push(p)
    if (p.includes("/commits?")) {
      return [
        { author: { login: "zoe", type: "User" }, commit: { author: { date: daysAgo(2) } } },
        { author: { login: "bob", type: "User" }, commit: { author: { date: daysAgo(3) } } },
        { author: { login: "nope", type: "User" }, commit: { author: { date: daysAgo(4) } } },
        { author: { login: "carl", type: "User" }, commit: { author: { date: daysAgo(5) } } },
        { author: { login: "dependabot[bot]", type: "Bot" }, commit: { author: { date: daysAgo(1) } } },
      ]
    }
    if (p.endsWith("/collaborators/zoe/permission")) return { permission: "read" }
    if (p.endsWith("/collaborators/bob/permission")) return { permission: "write" }
    if (p.endsWith("/collaborators/nope/permission")) return { permission: "none" }
    if (p.endsWith("/collaborators/carl/permission")) return { role_name: "admin" }
    throw new Error(`unexpected ${p}`)
  }

  const result = await computeSurfaceReviewers("gateway", { api, repo: "acme/kilo", now: NOW, map })
  assert.deepEqual(result.reviewers, ["bob", "carl"])
  assert.deepEqual(result.sourcePrefixes, surfaceSourcePrefixes("gateway", map))
  assert.ok(seen.some((p) => p === "/repos/acme/kilo/commits?path=packages%2Fkilo-gateway%2F&per_page=100"))
  assert.match(result.note, /packages\/kilo-gateway\//)
  assert.match(result.note, /half-life 180 days/)
  assert.match(result.note, /write/)
})

test("a 404 permission skips the candidate and keeps walking", async () => {
  const api = async (p) => {
    if (p.includes("/commits?")) {
      return [
        { author: { login: "ghost", type: "User" }, commit: { author: { date: daysAgo(1) } } },
        { author: { login: "real", type: "User" }, commit: { author: { date: daysAgo(2) } } },
      ]
    }
    if (p.includes("/ghost/")) {
      const err = new Error("Not Found")
      err.status = 404
      throw err
    }
    return { permission: "write" }
  }
  const result = await computeSurfaceReviewers("cli", { api, repo: "acme/kilo", now: NOW, map })
  assert.deepEqual(result.reviewers, ["real"])
})

test("API or token failure yields no reviewers and a named reason", async () => {
  const api = async () => {
    throw new Error("GH_TOKEN (or GITHUB_TOKEN) is required")
  }
  const result = await computeSurfaceReviewers("gateway", { api, repo: "acme/kilo", now: NOW, map })
  assert.deepEqual(result.reviewers, [])
  assert.match(result.note, /GH_TOKEN/)
})

test("a missing repository is named instead of guessed", async () => {
  const result = await computeSurfaceReviewers("gateway", { api: async () => [], map })
  assert.deepEqual(result.reviewers, [])
  assert.match(result.note, /GITHUB_REPOSITORY/)
})
