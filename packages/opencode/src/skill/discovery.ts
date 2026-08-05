import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient, path } from "@opencode-ai/core/effect/app-node-platform"
import { NodePath } from "@effect/platform-node"
import { Effect, Layer, Path, Schema, Context } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
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
    const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))
    const cache = path.join(Global.Path.cache, "skills")

    const download = Effect.fn("Discovery.download")(function* (url: string, dest: string) {
      if (yield* fs.exists(dest).pipe(Effect.orDie)) return true

      return yield* HttpClientRequest.get(url).pipe(
        http.execute,
        Effect.flatMap((res) => res.arrayBuffer),
        Effect.flatMap((body) => fs.writeWithDirs(dest, new Uint8Array(body))),
        Effect.as(true),
        Effect.catch((err) => Effect.logError("failed to download", { url: url, error: err }).pipe(Effect.as(false))),
      )
    })

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
            const fetchInto = (target: string) =>
              Effect.forEach(skill.files, (file) => download(file.url, path.join(target, file.rel)), {
                concurrency: fileConcurrency,
              })
            const current =
              version === undefined
                ? undefined
                : yield* fs.readFileStringSafe(versionFile).pipe(Effect.catch(() => Effect.succeed(undefined)))

            if (version === undefined || current === version) {
              yield* fetchInto(root)
            } else {
              const token = crypto.randomUUID()
              const staging = `${root}.tmp-${token}`
              const backup = `${root}.old-${token}`
              yield* Effect.gen(function* () {
                const downloaded = yield* fetchInto(staging)
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
