import type { LocationRef, OpenCodeClient } from "@opencode/client"
import { waitForModel } from "@opencode/client/kilocode/model-startup"
import { createComputed, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useClient } from "../context/client"
import { locationKey, useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { useLocation } from "../context/location"
import { useToast } from "../ui/toast"
import { parse } from "../util/model"

type Selection = { providerID: string; modelID: string; variant?: string }
type Target = { location?: LocationRef; sessionID?: string }
type Input = Target & { model?: Selection; command?: string; agent?: string; signal?: AbortSignal }

function enabled() {
  return process.env.KILO_MODEL_STARTUP === "1"
}

export function createModelStartup() {
  const client = useClient()
  const data = useData()
  const location = useLocation()
  const [selection, setSelection] = createSignal<Selection>()
  const [unavailable, setUnavailable] = createSignal(new Set<string>())
  const key = (ref: LocationRef, model?: Selection) =>
    JSON.stringify([locationKey(ref), model?.providerID, model?.modelID])
  const source = createMemo(
    () => {
      if (!enabled() || client.connection.status() !== "connected") return
      const ref = location.ref ?? data.location.default()
      const selected = selection()
      return {
        key: key(ref, selected),
        location: ref,
        model: selected ? { providerID: selected.providerID, id: selected.modelID } : undefined,
      }
    },
    undefined,
    { equals: (left, right) => left?.key === right?.key },
  )
  const [settled, setSettled] = createSignal<ReturnType<typeof source>>()
  createEffect(() => {
    const target = source()
    if (!target) return
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    void waitForModel(client.api, { ...target, signal: controller.signal })
      .then(async (ready) => {
        if (!ready && !controller.signal.aborted) setUnavailable((values) => new Set(values).add(target.key))
        if (ready && !controller.signal.aborted) {
          data.location.model.invalidate(target.location)
          await data.location.model.sync(target.location)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnavailable((values) => new Set(values).add(target.key))
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettled(target)
      })
  })
  return {
    observe(read: () => Selection | undefined) {
      createComputed(() => setSelection(read()))
    },
    preserve(...candidates: (Selection | undefined)[]) {
      if (!enabled()) return
      const selected = candidates.find((model) => model !== undefined)
      if (!selected) return
      const ref = location.ref ?? data.location.default()
      if (unavailable().has(key(ref, selected))) return
      if (data.location.model.list(ref)?.some((model) => model.providerID === selected.providerID)) return
      return selected
    },
    pending() {
      if (!enabled()) return false
      const target = source()
      if (!target) return true
      if (settled() === target) return false
      return !(data.location.model.list(target.location) ?? []).some(
        (model) =>
          model.enabled &&
          (model.type ?? "chat") === "chat" &&
          (model.capabilities.output.length === 0 ||
            model.capabilities.output.some((type) => type.startsWith("text"))) &&
          (!target.model || (model.providerID === target.model.providerID && model.id === target.model.id)),
      )
    },
  }
}

export async function waitForTuiModel(client: OpenCodeClient, input: Input) {
  if (!enabled()) return
  input.signal?.throwIfAborted()
  const saved =
    input.sessionID && (!input.location || !input.model)
      ? await client.session.get({ sessionID: input.sessionID }, { signal: input.signal })
      : undefined
  const location = input.location ?? saved?.location
  if (!location) return
  const agent =
    !input.model && input.agent
      ? (await client.agent.list({ location }, { signal: input.signal })).data.find((item) => item.id === input.agent)
      : undefined
  const selected = (await commandModel(client, location, input.command, input.signal)) ?? input.model
  const model = selected ? { providerID: selected.providerID, id: selected.modelID } : (saved?.model ?? agent?.model)
  await waitForModel(client, { location, model, signal: input.signal })
  input.signal?.throwIfAborted()
}

async function commandModel(client: OpenCodeClient, location: LocationRef, name?: string, signal?: AbortSignal) {
  if (!name) return
  const command = (await client.command.list({ location }, { signal })).data.find((item) => item.name === name)
  if (typeof command?.model === "string") return parse(command.model)
  if (command?.model) return { providerID: command.model.providerID, modelID: command.model.model }
}

export function createModelWait(signal: AbortSignal) {
  const pending = new Set<AbortController>()
  function wait(client: OpenCodeClient, input: Input) {
    if (!enabled()) return Promise.resolve(true)
    const controller = new AbortController()
    pending.add(controller)
    return waitForTuiModel(client, {
      ...input,
      signal: AbortSignal.any([signal, controller.signal, ...(input.signal ? [input.signal] : [])]),
    })
      .then(
        () => true,
        (error: unknown) => {
          if (controller.signal.aborted && !signal.aborted && !input.signal?.aborted) return false
          throw error
        },
      )
      .finally(() => pending.delete(controller))
  }
  return {
    wait,
    turn(
      client: OpenCodeClient,
      target: Target,
      next: { model?: Selection; agent?: string; prompt: { command?: { name: string } }; signal?: AbortSignal },
    ) {
      return wait(client, {
        ...target,
        ...next,
        model: next.prompt.command ? undefined : next.model,
        agent: next.prompt.command ? undefined : next.agent,
        command: next.prompt.command?.name,
      })
    },
    cancel: () => pending.forEach((controller) => controller.abort()),
  }
}

export function createModelAdmission() {
  const client = useClient()
  const data = useData()
  const toast = useToast()
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const [pending, setPending] = createSignal<AbortController>()
  Keymap.createLayer(() => ({
    priority: 1,
    enabled: !!pending(),
    commands: [{ id: "session.interrupt", run: () => pending()?.abort() }],
  }))
  async function wait(input: Input) {
    if (!enabled()) return true
    if (pending()) return false
    const attempt = new AbortController()
    setPending(attempt)
    const signal = AbortSignal.any([controller.signal, attempt.signal])
    return waitForTuiModel(client.api, { ...input, signal })
      .then(
        () => true,
        (error: unknown) => {
          if (!signal.aborted) toast.error(error)
          return false
        },
      )
      .finally(() => setPending(undefined))
  }
  return {
    wait(location: LocationRef, model: Selection, command?: string) {
      return wait({ location, model, command })
    },
    async compact(input: Parameters<typeof data.session.compact>[0]) {
      if (
        !(await wait({
          sessionID: input.sessionID,
          model: input.model ? { ...input.model, modelID: input.model.id } : undefined,
        }))
      )
        return
      return data.session.compact(input)
    },
  }
}
