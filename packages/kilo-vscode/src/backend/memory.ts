import type { OpenCodeClient } from "@opencode-ai/client/promise"
import {
  MemoryRpc,
  type MemoryRpcChange,
  type MemoryRpcIndex,
  type MemoryRpcStatus,
} from "@opencode-ai/schema/kilocode/memory"
import { result, type AdapterOptions } from "./result"

/**
 * Bounded translation of the v1 VS Code extension's memory domain
 * (kilo-provider/memory.ts) onto the public `kilocode.memory` RPC. The v1
 * client talked to `client.memory.{status,show,enable,disable,configure,
 * remember,correct,forget,rebuild,purge}`; the adapter keeps those method
 * names and projects the v1 shapes (estimated token count, named sources,
 * stored items) on top of the engine-backed RPC responses. No filesystem
 * access happens here: roots, state, and inventory all live host-side.
 */

type Scope = { directory?: string; workspace?: string }

type MemoryState = MemoryRpcStatus["state"]

export type MemoryStatus = MemoryRpcStatus & { index: MemoryRpcIndex & { estimatedTokens: number } }

/** The v1 consumer (KiloProviderMemory.doShow) reads items as one rendered string and the three named sources. */
export type MemoryShow = {
  root: string
  state: MemoryState
  sources: { project: string; environment: string; corrections: string }
  items: string
  index: string
}

export type MemoryChange = MemoryRpcChange & { index: MemoryRpcIndex & { estimatedTokens: number } }

export function createMemoryMethods(client: OpenCodeClient, defaultDirectory: string) {
  const memory = client.rpc(MemoryRpc.Definition)

  const location = (input: { directory?: string; workspace?: string } | undefined) => ({
    directory: input?.directory ?? defaultDirectory,
    ...(input?.workspace === undefined ? {} : { workspace: input.workspace }),
  })

  /** The v1 client read only the estimated token count off the index. */
  const withEstimatedTokens = <T extends { index: { tokens: number } }>(value: T) => ({
    ...value,
    index: { ...value.index, estimatedTokens: value.index.tokens },
  })

  return {
    memory: {
      status: <Throw extends boolean = false>(
        input: { directory?: string; workspace?: string; sessionID?: string } = {},
        options?: AdapterOptions<Throw>,
      ) =>
        result(async () => {
          const status = await memory.status({ sessionID: input.sessionID }, { ...options, location: location(input) })
          return withEstimatedTokens(status) as MemoryStatus
        }, options),
      show: <Throw extends boolean = false>(
        input: { directory?: string; workspace?: string } = {},
        options?: AdapterOptions<Throw>,
      ) =>
        result(async () => {
          const show = await memory.show({}, { ...options, location: location(input) })
          const named = (file: string) => show.sources[file] ?? ""
          return {
            root: show.root,
            state: show.state,
            sources: {
              project: named("project.md"),
              environment: named("environment.md"),
              corrections: named("corrections.md"),
            },
            items: (show.items ?? []).join("\n"),
            index: show.index,
          } satisfies MemoryShow
        }, options),
      enable: <Throw extends boolean = false>(
        input: { directory?: string; workspace?: string } = {},
        options?: AdapterOptions<Throw>,
      ) =>
        result(
          async () => (await memory.enable({}, { ...options, location: location(input) })) as MemoryState,
          options,
        ),
      disable: <Throw extends boolean = false>(
        input: { directory?: string; workspace?: string } = {},
        options?: AdapterOptions<Throw>,
      ) =>
        result(
          async () => (await memory.disable({}, { ...options, location: location(input) })) as MemoryState,
          options,
        ),
      /** The v1 configure(autoConsolidate) maps onto the auto on/off switch. */
      configure: <Throw extends boolean = false>(
        input: { autoConsolidate: boolean; directory?: string; workspace?: string },
        options?: AdapterOptions<Throw>,
      ) =>
        result(
          async () =>
            (await memory.auto(
              { mode: input.autoConsolidate ? "on" : "off" },
              { ...options, location: location(input) },
            )) as MemoryState,
          options,
        ),
      rebuild: <Throw extends boolean = false>(
        input: { directory?: string; workspace?: string } = {},
        options?: AdapterOptions<Throw>,
      ) =>
        result(async () => {
          const index = (await memory.rebuild({}, { ...options, location: location(input) })) as MemoryRpcIndex
          return { ...index, estimatedTokens: index.tokens } as MemoryChange["index"]
        }, options),
      purge: <Throw extends boolean = false>(
        input: { confirm?: boolean; directory?: string; workspace?: string },
        options?: AdapterOptions<Throw>,
      ) =>
        result(async () => {
          // The v1 client gated purge on an explicit confirmation and the RPC
          // contract only accepts an explicit true; never manufacture it.
          if (input.confirm !== true) throw new Error("Memory purge requires confirmation")
          return memory.purge({ confirm: true }, { ...options, location: location(input) })
        }, options),
      remember: <Throw extends boolean = false>(
        input: {
          text: string
          key?: string
          file?: "project.md" | "environment.md" | "corrections.md"
          section?: string
          sessionID?: string
          directory?: string
          workspace?: string
        },
        options?: AdapterOptions<Throw>,
      ) =>
        result(async () => {
          const change = await memory.remember(
            {
              text: input.text,
              ...(input.key === undefined ? {} : { key: input.key }),
              ...(input.file === undefined ? {} : { file: input.file }),
              ...(input.section === undefined ? {} : { section: input.section }),
              ...(input.sessionID === undefined ? {} : { sessionID: input.sessionID }),
            },
            { ...options, location: location(input) },
          )
          return withEstimatedTokens(change) as MemoryChange
        }, options),
      correct: <Throw extends boolean = false>(
        input: { text: string; key?: string; sessionID?: string; directory?: string; workspace?: string },
        options?: AdapterOptions<Throw>,
      ) =>
        result(async () => {
          const change = await memory.correct(
            {
              text: input.text,
              ...(input.key === undefined ? {} : { key: input.key }),
              ...(input.sessionID === undefined ? {} : { sessionID: input.sessionID }),
            },
            { ...options, location: location(input) },
          )
          return withEstimatedTokens(change) as MemoryChange
        }, options),
      forget: <Throw extends boolean = false>(
        input: { query: string; sessionID?: string; directory?: string; workspace?: string },
        options?: AdapterOptions<Throw>,
      ) =>
        result(async () => {
          const change = await memory.forget(
            { query: input.query, ...(input.sessionID === undefined ? {} : { sessionID: input.sessionID }) },
            { ...options, location: location(input) },
          )
          return withEstimatedTokens(change) as MemoryChange
        }, options),
      inspect: <Throw extends boolean = false>(
        input: { directory?: string; workspace?: string } = {},
        options?: AdapterOptions<Throw>,
      ) => result(async () => memory.inspect({}, { ...options, location: location(input) }), options),
    },
  }
}
