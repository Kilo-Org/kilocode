import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Layer, Context } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Flag } from "@opencode-ai/core/flag/flag"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { Global } from "@opencode-ai/core/global"
import { KilocodeInstruction } from "@/kilocode/session/instruction" // kilocode_change
import type { KilocodeMarkdown } from "@/kilocode/config/markdown" // kilocode_change
import type { MessageV2 } from "./message-v2"
import type { MessageID } from "./schema"

function extract(messages: SessionV1.WithParts[]) {
  const paths = new Set<string>()
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "tool" && part.tool === "read" && part.state.status === "completed") {
        if (part.state.time.compacted) continue
        const loaded = part.state.metadata?.loaded
        if (!loaded || !Array.isArray(loaded)) continue
        for (const p of loaded) {
          if (typeof p === "string") paths.add(p)
        }
      }
    }
  }
  return paths
}

export interface Interface {
  readonly clear: (messageID: MessageID) => Effect.Effect<void>
  readonly systemPaths: () => Effect.Effect<Set<string>, FSUtil.Error>
  readonly system: () => Effect.Effect<string[], FSUtil.Error>
  readonly find: (dir: string) => Effect.Effect<string | undefined, FSUtil.Error>
  readonly resolve: (
    messages: SessionV1.WithParts[],
    filepath: string,
    messageID: MessageID,
  ) => Effect.Effect<{ filepath: string; content: string }[], FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Instruction") {}

export const layer: Layer.Layer<
  Service,
  never,
  FSUtil.Service | Config.Service | Global.Service | HttpClient.HttpClient | RuntimeFlags.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const flags = yield* RuntimeFlags.Service
    const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))
    const globalFiles = [
      // kilocode_change start - prefer KILO_CONFIG_DIR profile when set
      ...(Flag.KILO_CONFIG_DIR ? [path.join(Flag.KILO_CONFIG_DIR, "AGENTS.md")] : []),
      // kilocode_change end
      path.join(global.config, "AGENTS.md"),
      ...(!flags.disableClaudeCodePrompt ? [path.join(global.home, ".claude", "CLAUDE.md")] : []),
    ]
    const instructionFiles = [
      "AGENTS.md",
      ...(!flags.disableClaudeCodePrompt ? ["CLAUDE.md"] : []),
      "CONTEXT.md", // deprecated
    ]

    const state = yield* InstanceState.make(
      Effect.fn("Instruction.state")(() =>
        Effect.succeed({
          // Track which instruction files have already been attached for a given assistant message.
          claims: new Map<MessageID, Set<string>>(),
        }),
      ),
    )

    const relative = Effect.fnUntraced(function* (instruction: string) {
      const ctx = yield* InstanceState.context
      if (!Flag.KILO_DISABLE_PROJECT_CONFIG) {
        return yield* fs
          .globUp(instruction, ctx.directory, ctx.worktree)
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))
      }
      // kilocode_change - prefer KILO_CONFIG_DIR profile when set, else fall back to global.config
      const root = Flag.KILO_CONFIG_DIR ?? global.config
      return yield* fs.globUp(instruction, root, root).pipe(Effect.catch(() => Effect.succeed([] as string[]))) // kilocode_change
    })

    // kilocode_change start - project instructions cannot read env or files outside the project root
    const options = Effect.fnUntraced(function* (filepath: string, origin?: KilocodeMarkdown.Source) {
      const ctx = yield* InstanceState.context
      const root = ctx.worktree === "/" ? ctx.directory : ctx.worktree
      const trusted = origin?.trusted ?? false
      return {
        trusted,
        fileScope: trusted ? undefined : { root: origin?.root ?? root, source: origin?.source ?? filepath },
      }
    })

    const read = Effect.fnUntraced(function* (filepath: string, origin?: KilocodeMarkdown.Source) {
      const opts = yield* options(filepath, origin)
      const ctx = yield* InstanceState.context
      return yield* Effect.promise(() => KilocodeInstruction.read(filepath, opts, ctx).catch(() => ""))
    })
    // kilocode_change end

    const fetch = Effect.fnUntraced(function* (url: string) {
      const res = yield* http.execute(HttpClientRequest.get(url)).pipe(
        Effect.timeout(5000),
        Effect.catch(() => Effect.succeed(null)),
      )
      if (!res) return ""
      const body = yield* res.arrayBuffer.pipe(Effect.catch(() => Effect.succeed(new ArrayBuffer(0))))
      return new TextDecoder().decode(body)
    })

    const clear = Effect.fn("Instruction.clear")(function* (messageID: MessageID) {
      const s = yield* InstanceState.get(state)
      s.claims.delete(messageID)
    })

    // kilocode_change start - retain declaration provenance through instruction path expansion
    const systemSources = Effect.fn("Instruction.systemSources")(function* () {
      const config = yield* cfg.get()
      const ctx = yield* InstanceState.context
      const root = ctx.worktree === "/" ? ctx.directory : ctx.worktree
      const paths = new Map<string, KilocodeMarkdown.Source>()
      const add = (item: string, origin: KilocodeMarkdown.Source) => {
        const filepath = path.resolve(item)
        if (paths.get(filepath)?.trusted) return
        paths.set(filepath, origin)
      }

      for (const file of globalFiles) {
        if (yield* fs.existsSafe(file)) {
          add(file, { trusted: true, source: file })
          break
        }
      }

      // The first project-level match wins so we don't stack AGENTS.md/CLAUDE.md from every ancestor.
      if (!Flag.KILO_DISABLE_PROJECT_CONFIG) {
        for (const file of instructionFiles) {
          const matches = yield* fs
            .findUp(file, ctx.directory, ctx.worktree)
            .pipe(Effect.catch(() => Effect.succeed([])))
          if (matches.length > 0) {
            matches.forEach((item) => add(item, { trusted: false, source: item, root }))
            break
          }
        }
      }

      if (config.instructions) {
        for (const raw of config.instructions) {
          if (raw.startsWith("https://") || raw.startsWith("http://")) continue
          const instruction = raw.startsWith("~/") ? path.join(global.home, raw.slice(2)) : raw
          const matches = yield* (
            path.isAbsolute(instruction)
              ? fs.glob(path.basename(instruction), {
                  cwd: path.dirname(instruction),
                  absolute: true,
                  include: "file",
                })
              : relative(instruction)
          ).pipe(Effect.catch(() => Effect.succeed([] as string[])))
          const declared = config.instruction_origins?.[raw] ?? { trusted: false, source: raw, root }
          const trusted = declared.trusted && (path.isAbsolute(instruction) || Flag.KILO_DISABLE_PROJECT_CONFIG)
          const origin = { ...declared, trusted, root: trusted ? undefined : (declared.root ?? root) }
          matches.forEach((item) => add(item, origin))
        }
      }

      return paths
    })

    const systemPaths = Effect.fn("Instruction.systemPaths")(function* () {
      return new Set((yield* systemSources()).keys())
    })
    // kilocode_change end

    const system = Effect.fn("Instruction.system")(function* () {
      const config = yield* cfg.get()
      const sources = yield* systemSources() // kilocode_change
      const paths = Array.from(sources.keys()) // kilocode_change
      const urls = (config.instructions ?? []).filter(
        (item) => item.startsWith("https://") || item.startsWith("http://"),
      )

      // kilocode_change start
      const files = yield* Effect.forEach(Array.from(sources.entries()), (item) => read(item[0], item[1]), {
        concurrency: 8,
      })
      // kilocode_change end
      const remote = yield* Effect.forEach(urls, fetch, { concurrency: 4 })

      return [
        ...paths.flatMap((item, i) => (files[i] ? [`Instructions from: ${item}\n${files[i]}`] : [])), // kilocode_change
        ...urls.flatMap((item, i) => (remote[i] ? [`Instructions from: ${item}\n${remote[i]}`] : [])),
      ]
    })

    const find = Effect.fn("Instruction.find")(function* (dir: string) {
      for (const file of instructionFiles) {
        const filepath = path.resolve(path.join(dir, file))
        if (yield* fs.existsSafe(filepath)) return filepath
      }
      return undefined
    })

    const resolve = Effect.fn("Instruction.resolve")(function* (
      messages: SessionV1.WithParts[],
      filepath: string,
      messageID: MessageID,
    ) {
      const sys = yield* systemPaths()
      const already = extract(messages)
      const results: { filepath: string; content: string }[] = []
      const s = yield* InstanceState.get(state)
      const root = path.resolve(yield* InstanceState.directory)

      const target = path.resolve(filepath)
      let current = path.dirname(target)

      // Walk upward from the file being read and attach nearby instruction files once per message.
      while (current.startsWith(root) && current !== root) {
        const found = yield* find(current)
        if (!found || found === target || sys.has(found) || already.has(found)) {
          current = path.dirname(current)
          continue
        }

        let set = s.claims.get(messageID)
        if (!set) {
          set = new Set()
          s.claims.set(messageID, set)
        }
        if (set.has(found)) {
          current = path.dirname(current)
          continue
        }

        set.add(found)
        const content = yield* read(found)
        if (content) {
          results.push({ filepath: found, content: `Instructions from: ${found}\n${content}` })
        }

        current = path.dirname(current)
      }

      return results
    })

    return Service.of({ clear, systemPaths, system, find, resolve })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

export function loaded(messages: SessionV1.WithParts[]) {
  return extract(messages)
}

export * as Instruction from "./instruction"
