import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient, path } from "@opencode-ai/core/effect/app-node-platform"
import { Effect, Layer, Path, Schema, Context } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { isSafeSegment, isSafeRelativePath } from "@/kilocode/skill/discovery-validate" // kilocode_change

const skillConcurrency = 4
const fileConcurrency = 8

class IndexSkill extends Schema.Class<IndexSkill>("IndexSkill")({
  name: Schema.String,
  files: Schema.Array(Schema.String),
  version: Schema.optional(Schema.String),
}) {}

class Index extends Schema.Class<Index>("Index")({
  skills: Schema.Array(IndexSkill),
}) {}

export interface Interface {
  readonly pull: (url: string) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SkillDiscovery") {}

const layer: Layer.Layer<Service, never, FSUtil.Service | Path.Path | HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const path = yield* Path.Path
    const client = yield* HttpClient.HttpClient
    const httpRaw = withTransientReadRetry(client)
    const http = HttpClient.filterStatusOk(httpRaw)
    const cache = path.join(Global.Path.cache, "skills")

    // kilocode_change start - revalidate cached URL skill files using ETag/Last-Modified
    // sidecars so stale copies are not returned forever.
    const etagFile = (dest: string) => `${dest}.etag`
    const lastmodFile = (dest: string) => `${dest}.lastmod`

    const readTag = (tag: string) =>
      Effect.gen(function* () {
        if (!(yield* fs.exists(tag).pipe(Effect.orDie))) return undefined
        return yield* fs.readFileStringSafe(tag).pipe(Effect.catch(() => Effect.succeed(undefined)))
      })

    const writeTag = (tag: string, value: string | null) =>
      value ? fs.writeWithDirs(tag, value) : fs.remove(tag, { force: true }).pipe(Effect.ignore)

    const download = Effect.fn("Discovery.download")(function* (url: string, dest: string, revalidate: boolean) {
      const exists = yield* fs.exists(dest).pipe(Effect.orDie)
      if (exists && !revalidate) return true

      const headers: Record<string, string> = {}
      if (revalidate) {
        const etag = yield* readTag(etagFile(dest))
        if (etag) headers["If-None-Match"] = etag
        const lastmod = yield* readTag(lastmodFile(dest))
        if (lastmod) headers["If-Modified-Since"] = lastmod
      }

      return yield* Effect.gen(function* () {
        const res = yield* HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeaders(headers),
          httpRaw.execute,
        )
        if (res.status === 304) return true
        if (res.status !== 200) {
          yield* Effect.logError("failed to download", { url, status: res.status })
          return false
        }
        const body = yield* res.arrayBuffer
        yield* fs.writeWithDirs(dest, new Uint8Array(body))
        yield* writeTag(etagFile(dest), res.headers["etag"] ?? null)
        yield* writeTag(lastmodFile(dest), res.headers["last-modified"] ?? null)
        return true
      }).pipe(Effect.catch((err) => Effect.logError("failed to download", { url, error: err }).pipe(Effect.as(false))))
    })
    // kilocode_change end

    const pull = Effect.fn("Discovery.pull")(function* (url: string) {
      const base = url.endsWith("/") ? url : `${url}/`
      // kilocode_change start - resolve the index origin so file downloads can be pinned to it
      const source = new URL(base)
      const index = new URL("index.json", source).href
      // kilocode_change end

      yield* Effect.logInfo("fetching index", { url: index })

      const data = yield* HttpClientRequest.get(index).pipe(
        HttpClientRequest.acceptJson,
        http.execute,
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Index)),
        Effect.catch((err) =>
          Effect.logError("failed to fetch index", { url: index, error: err }).pipe(Effect.as(null)),
        ),
      )

      if (!data) return []

      // kilocode_change start - the remote index controls skill.name and file, so validate every segment,
      // pin file downloads to the index origin, and confine writes to the cache (mirrors core v2 SkillDiscovery)
      const contained = (parent: string, child: string) => {
        const rel = path.relative(parent, child)
        return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
      }
      const plan = (skill: IndexSkill) => {
        if (!skill.files.includes("SKILL.md")) return "skill entry missing SKILL.md"
        if (!isSafeSegment(skill.name)) return "skipping skill with unsafe name"
        const root = path.join(cache, skill.name)
        if (!contained(cache, root)) return "skipping skill with unsafe name"
        const skillUrl = new URL(`${encodeURIComponent(skill.name)}/`, source)
        const files: { url: string; rel: string }[] = []
        for (const file of skill.files) {
          if (!isSafeRelativePath(file)) return "skipping skill with unsafe file path"
          const resource = URL.parse(file, skillUrl) ?? undefined
          if (!resource || resource.origin !== source.origin) return "skipping skill with cross-origin file"
          if (!contained(root, path.join(root, file))) return "skipping skill with unsafe file path"
          files.push({ url: resource.href, rel: file })
        }
        return { name: skill.name, version: skill.version, root, files }
      }

      const planned: {
        name: string
        version: string | undefined
        root: string
        files: { url: string; rel: string }[]
      }[] = []
      for (const skill of data.skills) {
        const result = plan(skill)
        if (typeof result === "string") yield* Effect.logWarning(result, { url: index, skill: skill.name })
        else planned.push(result)
      }
      // kilocode_change end

      // kilocode_change start - download each validated, origin-pinned, cache-confined plan
      const dirs = yield* Effect.forEach(
        planned,
        (skill) =>
          Effect.gen(function* () {
            const { root, version } = skill
            const versionFile = path.join(root, ".opencode-version")
            // kilocode_change start - pass revalidate so unversioned files are revalidated and
            // versioned files short-circuit on existing copies.
            const fetchInto = (target: string, revalidate: boolean) =>
              Effect.forEach(skill.files, (file) => download(file.url, path.join(target, file.rel), revalidate), {
                concurrency: fileConcurrency,
              })
            // kilocode_change end
            const current =
              version === undefined
                ? undefined
                : yield* fs.readFileStringSafe(versionFile).pipe(Effect.catch(() => Effect.succeed(undefined)))

            if (version === undefined || current === version) {
              yield* fetchInto(root, version === undefined)
            } else {
              const token = crypto.randomUUID()
              const staging = `${root}.tmp-${token}`
              const backup = `${root}.old-${token}`
              yield* Effect.gen(function* () {
                const downloaded = yield* fetchInto(staging, false)
                if (!downloaded.every(Boolean)) return
                if (!(yield* fs.exists(path.join(staging, "SKILL.md")).pipe(Effect.orDie))) return
                yield* fs.writeFileString(path.join(staging, ".opencode-version"), version)
                yield* Effect.uninterruptible(
                  Effect.gen(function* () {
                    const cached = yield* fs.exists(root).pipe(Effect.orDie)
                    if (cached) yield* fs.rename(root, backup)
                    yield* fs.rename(staging, root).pipe(
                      Effect.catch((error) =>
                        Effect.gen(function* () {
                          if (cached) yield* fs.rename(backup, root).pipe(Effect.ignore)
                          return yield* Effect.fail(error)
                        }),
                      ),
                    )
                    if (cached) yield* fs.remove(backup, { recursive: true, force: true }).pipe(Effect.ignore)
                  }),
                )
              }).pipe(
                Effect.catch((error) => Effect.logError("failed to refresh skill", { skill: skill.name, error })),
                Effect.ensuring(fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore)),
              )
            }
            return (yield* fs.exists(path.join(root, "SKILL.md")).pipe(Effect.orDie)) ? root : null
          }),
        { concurrency: skillConcurrency },
      )
      // kilocode_change end

      return dirs.filter((dir): dir is string => dir !== null)
    })

    return Service.of({ pull })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node, path, httpClient] })

export * as Discovery from "./discovery"
