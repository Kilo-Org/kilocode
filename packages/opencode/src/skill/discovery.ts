import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient, path } from "@opencode-ai/core/effect/layer-node-platform"
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
}) {}

class Index extends Schema.Class<Index>("Index")({
  skills: Schema.Array(IndexSkill),
}) {}

export interface Interface {
  readonly pull: (url: string) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SkillDiscovery") {}

export const layer: Layer.Layer<Service, never, FSUtil.Service | Path.Path | HttpClient.HttpClient> = Layer.effect(
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
        const files: { url: string; dest: string }[] = []
        for (const file of skill.files) {
          if (!isSafeRelativePath(file)) return "skipping skill with unsafe file path"
          const resource = URL.parse(file, skillUrl) ?? undefined
          if (!resource || resource.origin !== source.origin) return "skipping skill with cross-origin file"
          const dest = path.join(root, file)
          if (!contained(root, dest)) return "skipping skill with unsafe file path"
          files.push({ url: resource.href, dest })
        }
        return { root, files }
      }

      const planned: { root: string; files: { url: string; dest: string }[] }[] = []
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
            yield* Effect.forEach(skill.files, (file) => download(file.url, file.dest), {
              concurrency: fileConcurrency,
            })
            const md = path.join(skill.root, "SKILL.md")
            return (yield* fs.exists(md).pipe(Effect.orDie)) ? skill.root : null
          }),
        { concurrency: skillConcurrency },
      )
      // kilocode_change end

      return dirs.filter((dir): dir is string => dir !== null)
    })

    return Service.of({ pull })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(NodePath.layer),
)

export const node = LayerNode.make(layer, [FSUtil.node, path, httpClient])

export * as Discovery from "./discovery"
