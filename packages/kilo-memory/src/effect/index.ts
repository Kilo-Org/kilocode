import { Memory } from "../memory"
import type { MemoryOperations } from "../capture/operations"
import { MemorySchema } from "../schema"
import { MemoryFiles } from "../storage/store"
import { MemoryToken } from "../recall/token"
import { MemoryEvents } from "./events"
import { MemoryPaths } from "./paths"
import { MemoryTimers } from "./timers"
import { MemoryDisabledError } from "./errors"

/** Context-bound Kilo adapter over the root-bound package primitives. Prefer ctx inputs at runtime edges. */
export namespace KiloMemory {
  export type Input =
    | {
        root: string
        sessionID?: string
        record?: boolean
      }
    | {
        ctx: MemoryPaths.Ctx
        sessionID?: string
        record?: boolean
      }

  export type Block = Memory.Block

  function root(input: Input) {
    return "root" in input ? input.root : MemoryPaths.root(input)
  }

  async function noop(dir: string): Promise<MemoryOperations.Result> {
    const text = await MemoryFiles.readIndex(dir)
    const index = {
      text,
      bytes: Buffer.byteLength(text),
      tokens: MemoryToken.estimate(text),
      truncated: false,
    }
    return { operationCount: 0, added: 0, removed: 0, skipped: [], index }
  }

  async function requireEnabled(dir: string) {
    const state = await MemoryFiles.readState(dir)
    if (state.enabled) return state
    throw new MemoryDisabledError({ reason: "project memory is disabled" })
  }

  export async function prepare(input: Input) {
    return root(input)
  }

  export async function status(input: Input) {
    return Memory.status({ root: await prepare(input) })
  }

  export async function enable(input: Input) {
    const dir = await prepare(input)
    const id = "ctx" in input ? MemoryPaths.identity({ ctx: input.ctx }) : undefined
    const result = await Memory.enable({ root: dir, id })
    await MemoryEvents.publish({
      event: "status",
      payload: MemoryEvents.status({
        root: dir,
        state: result.state,
        index: result.index,
        phase: "idle",
        consolidation: { trigger: "rebuild", operationCount: 0, cost: 0, tokens: result.index.tokens },
      }),
    })
    return result
  }

  export async function disable(input: Input) {
    const dir = await prepare(input)
    MemoryTimers.clear(dir)
    const result = await Memory.disable({ root: dir })
    await MemoryEvents.publish({
      event: "status",
      payload: MemoryEvents.status({ root: result.root, state: result.state, phase: "idle" }),
    })
    return result
  }

  export async function show(input: Input) {
    return Memory.show({ root: await prepare(input) })
  }

  export async function rebuild(input: Input) {
    const dir = await prepare(input)
    const state = await MemoryFiles.readState(dir)
    if (!state.enabled) {
      const index = (await noop(dir)).index
      return { root: dir, state, index }
    }
    const result = await Memory.rebuild({ root: dir })
    await MemoryEvents.publish({
      event: "updated",
      payload: MemoryEvents.status({
        root: result.root,
        state: result.state,
        index: result.index,
        phase: "idle",
        consolidation: { trigger: "rebuild", operationCount: 0, cost: 0, tokens: result.index.tokens },
      }),
    })
    return result
  }

  export async function configure(
    input: Input & {
      settings: Partial<Pick<MemorySchema.State, "autoConsolidate" | "verbose">>
    },
  ) {
    const result = await Memory.configure({ root: await prepare(input), settings: input.settings })
    await MemoryEvents.publish({
      event: "status",
      payload: MemoryEvents.status({ root: result.root, state: result.state, phase: "idle" }),
    })
    return result
  }

  export async function context(input: Input) {
    const result = await Memory.context({
      root: await prepare(input),
      sessionID: input.sessionID,
      record: input.record,
    })
    if (result.recorded) {
      await MemoryEvents.publish({
        event: "status",
        payload: MemoryEvents.status({
          root: result.root,
          state: result.state,
          index: result.index,
          phase: "injecting",
          sessionID: input.sessionID,
        }),
      })
    }
    return result
  }

  export async function toolEnabled(input: Input) {
    return Memory.toolEnabled({ root: "ctx" in input ? await prepare(input) : root(input) })
  }

  async function publish(input: {
    output: Memory.Apply
    sessionID?: string
    trigger?: Memory.Trigger
    cost?: number
    tokens?: number
  }) {
    await MemoryEvents.publish({
      event: "updated",
      payload: MemoryEvents.status({
        root: input.output.root,
        state: input.output.state,
        index: input.output.result.index,
        phase: "updating",
        sessionID: input.sessionID,
        consolidation: {
          trigger: input.trigger ?? "explicit",
          operationCount: input.output.result.operationCount,
          cost: input.cost ?? 0,
          tokens: input.tokens ?? 0,
        },
        ...(input.output.detail ? { detail: input.output.detail } : {}),
      }),
    })
  }

  export async function apply(
    input: Input & {
      ops: MemoryOperations.Op[]
      trigger?: Memory.Trigger
      cost?: number
      tokens?: number
    },
  ) {
    const dir = await prepare(input)
    await requireEnabled(dir)
    const output = await Memory.apply({
      root: dir,
      ops: input.ops,
      trigger: input.trigger,
      sessionID: input.sessionID,
      tokens: input.tokens,
    })
    await publish({
      output,
      sessionID: input.sessionID,
      trigger: input.trigger,
      cost: input.cost,
      tokens: input.tokens,
    })
    return output.result
  }

  export async function forget(input: Input & { query: string }) {
    const dir = await prepare(input)
    await requireEnabled(dir)
    const output = await Memory.forget({ root: dir, query: input.query, sessionID: input.sessionID })
    await publish({ output, sessionID: input.sessionID })
    return output.result
  }

  export async function remember(
    input: Input & {
      text: string
      key?: string
      file?: MemorySchema.Source
      section?: string
    },
  ) {
    const dir = await prepare(input)
    await requireEnabled(dir)
    const output = await Memory.remember({
      root: dir,
      text: input.text,
      key: input.key,
      file: input.file,
      section: input.section,
      sessionID: input.sessionID,
    })
    await publish({ output, sessionID: input.sessionID })
    return output.result
  }

  export async function correct(input: Input & { text: string; key?: string }) {
    const dir = await prepare(input)
    await requireEnabled(dir)
    const output = await Memory.correct({
      root: dir,
      text: input.text,
      key: input.key,
      sessionID: input.sessionID,
    })
    await publish({ output, sessionID: input.sessionID })
    return output.result
  }

  export async function purge(input: Input) {
    const dir = root(input)
    MemoryTimers.clear(dir)
    const result = await Memory.purge({ root: dir })
    await MemoryEvents.publish({
      event: "status",
      payload: MemoryEvents.status({
        root: result.root,
        state: result.state,
        phase: "idle",
        reason: result.purged ? "purged" : "missing",
      }),
    })
    return { root: result.root, purged: result.purged }
  }

  export async function recall(input: Input & { query: string; sessionID?: string }) {
    const output = await Memory.recall({ root: await prepare(input), query: input.query, sessionID: input.sessionID })
    if (!output.state.enabled) return
    if (!output.result) {
      await MemoryEvents.publish({
        event: "status",
        payload: MemoryEvents.status({
          root: output.root,
          state: output.state,
          phase: "skipped",
          sessionID: input.sessionID,
          detail: {
            type: "skipped",
            message: "Memory skipped · no recall matches",
            reason: "no_matches",
            skippedCount: 1,
          },
        }),
      })
      return
    }
    await MemoryEvents.publish({
      event: "status",
      payload: MemoryEvents.status({
        root: output.root,
        state: output.state,
        phase: "injecting",
        sessionID: input.sessionID,
        detail: {
          type: "recalled",
          message: `Memory recalled · ${output.result.hits.length} ${output.result.hits.length === 1 ? "item" : "items"}`,
          tokens: output.result.tokens,
          operationCount: output.result.hits.length,
          sources: output.files,
          files: output.files,
        },
      }),
    })
    return { root: output.root, ...output.result }
  }

  export async function recordSession(
    input: Input & {
      sessionID: string
      topic?: string
      summary: string
      time?: number
      tokens?: number
      fallback?: boolean
    },
  ) {
    const output = await Memory.recordSession({
      root: await prepare(input),
      sessionID: input.sessionID,
      topic: input.topic,
      summary: input.summary,
      time: input.time,
      tokens: input.tokens,
      fallback: input.fallback,
    })
    if (output.skipped) {
      await MemoryEvents.publish({
        event: "status",
        payload: MemoryEvents.status({
          root: output.root,
          state: output.state,
          phase: "skipped",
          reason: output.reason,
          sessionID: input.sessionID,
        }),
      })
      return { skipped: true, reason: output.reason }
    }
    await MemoryEvents.publish({
      event: "updated",
      payload: MemoryEvents.status({
        root: output.root,
        state: output.state,
        index: output.index,
        phase: "updating",
        sessionID: input.sessionID,
        consolidation: { trigger: "turn-close", operationCount: 0, cost: 0, tokens: input.tokens ?? 0 },
      }),
    })
    return { skipped: false, index: output.index }
  }
}

export { MemoryEvents } from "./events"
export { MemoryPaths } from "./paths"
