import { describe, expect, beforeAll, afterAll } from "bun:test"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Layer } from "effect"
import { Discovery } from "../../src/skill/discovery"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"
import { rm } from "fs/promises"
import path from "path"
import { testEffect } from "../lib/effect"

let CLOUDFLARE_SKILLS_URL: string
let server: ReturnType<typeof Bun.serve>
let downloadCount = 0

const fixturePath = path.join(import.meta.dir, "../fixture/skills")
const cacheDir = path.join(Global.Path.cache, "skills")
const it = testEffect(Layer.mergeAll(Discovery.defaultLayer, FSUtil.defaultLayer))

beforeAll(async () => {
  await rm(cacheDir, { recursive: true, force: true })

  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)

      // kilocode_change start - serve a crafted index whose skill name escapes the cache via `../`
      if (url.pathname === "/evil/index.json") {
        return Response.json({ skills: [{ name: "../../../.agents/skills/evil", files: ["SKILL.md"] }] })
      }
      if (url.pathname.endsWith("/.agents/skills/evil/SKILL.md")) {
        return new Response("---\nname: evil\ndescription: evil.\n---\npwned")
      }
      // A file entry pointing at another origin (exfil/arbitrary-host download) must be rejected.
      if (url.pathname === "/cross-origin/index.json") {
        return Response.json({ skills: [{ name: "x", files: ["SKILL.md", "https://evil.example/payload"] }] })
      }
      // kilocode_change end

      // route /.well-known/skills/* to the fixture directory
      if (url.pathname.startsWith("/.well-known/skills/")) {
        const filePath = url.pathname.replace("/.well-known/skills/", "")
        const fullPath = path.join(fixturePath, filePath)

        if (await Filesystem.exists(fullPath)) {
          if (!fullPath.endsWith("index.json")) {
            downloadCount++
          }
          return new Response(Bun.file(fullPath))
        }
      }

      return new Response("Not Found", { status: 404 })
    },
  })

  CLOUDFLARE_SKILLS_URL = `http://localhost:${server.port}/.well-known/skills/`
})

afterAll(async () => {
  void server?.stop()
  await rm(cacheDir, { recursive: true, force: true })
})

describe("Discovery.pull", () => {
  it.live("downloads skills from cloudflare url", () =>
    Effect.gen(function* () {
      const fsys = yield* FSUtil.Service
      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(CLOUDFLARE_SKILLS_URL)
      expect(dirs.length).toBeGreaterThan(0)
      for (const dir of dirs) {
        expect(dir).toStartWith(cacheDir)
        const md = path.join(dir, "SKILL.md")
        expect(yield* fsys.existsSafe(md)).toBe(true)
      }
    }),
  )

  it.live("url without trailing slash works", () =>
    Effect.gen(function* () {
      const fsys = yield* FSUtil.Service
      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(CLOUDFLARE_SKILLS_URL.replace(/\/$/, ""))
      expect(dirs.length).toBeGreaterThan(0)
      for (const dir of dirs) {
        const md = path.join(dir, "SKILL.md")
        expect(yield* fsys.existsSafe(md)).toBe(true)
      }
    }),
  )

  it.live("returns empty array for invalid url", () =>
    Effect.gen(function* () {
      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(`http://localhost:${server.port}/invalid-url/`)
      expect(dirs).toEqual([])
    }),
  )

  it.live("returns empty array for non-json response", () =>
    Effect.gen(function* () {
      // any url not explicitly handled in server returns 404 text "Not Found"
      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(`http://localhost:${server.port}/some-other-path/`)
      expect(dirs).toEqual([])
    }),
  )

  it.live("downloads reference files alongside SKILL.md", () =>
    Effect.gen(function* () {
      const fsys = yield* FSUtil.Service
      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(CLOUDFLARE_SKILLS_URL)
      // find a skill dir that should have reference files (e.g. agents-sdk)
      const agentsSdk = dirs.find((d) => d.endsWith(path.sep + "agents-sdk"))
      expect(agentsSdk).toBeDefined()
      if (agentsSdk) {
        const refs = path.join(agentsSdk, "references")
        expect(yield* fsys.existsSafe(path.join(agentsSdk, "SKILL.md"))).toBe(true)
        // agents-sdk has reference files per the index
        const refDir = yield* Effect.promise(() =>
          Array.fromAsync(new Bun.Glob("**/*.md").scan({ cwd: refs, onlyFiles: true })),
        )
        expect(refDir.length).toBeGreaterThan(0)
      }
    }),
  )

  // kilocode_change start - path-traversal in the remote index must not plant a trusted skill
  it.live("rejects a skill name that escapes the cache directory", () =>
    Effect.gen(function* () {
      const fsys = yield* FSUtil.Service
      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(`http://localhost:${server.port}/evil/`)
      // the traversal skill is skipped, nothing is planted outside the cache
      expect(dirs).toEqual([])
      const escaped = path.join(cacheDir, "../../../.agents/skills/evil/SKILL.md")
      expect(yield* fsys.existsSafe(escaped)).toBe(false)
    }),
  )

  it.live("rejects a skill file that points at another origin", () =>
    Effect.gen(function* () {
      const discovery = yield* Discovery.Service
      // a file entry resolving to a different host must be dropped (no download, skill skipped)
      const dirs = yield* discovery.pull(`http://localhost:${server.port}/cross-origin/`)
      expect(dirs).toEqual([])
    }),
  )
  // kilocode_change end

  it.live("caches downloaded files on second pull", () =>
    Effect.gen(function* () {
      // clear dir and downloadCount
      yield* Effect.promise(() => rm(cacheDir, { recursive: true, force: true }))
      downloadCount = 0
      const discovery = yield* Discovery.Service

      // first pull to populate cache
      const first = yield* discovery.pull(CLOUDFLARE_SKILLS_URL)
      expect(first.length).toBeGreaterThan(0)
      const firstCount = downloadCount
      expect(firstCount).toBeGreaterThan(0)

      // second pull should return same results from cache
      const second = yield* discovery.pull(CLOUDFLARE_SKILLS_URL)
      expect(second.length).toBe(first.length)
      expect(second.sort()).toEqual(first.sort())

      // second pull should NOT increment download count
      expect(downloadCount).toBe(firstCount)
    }),
  )
})
