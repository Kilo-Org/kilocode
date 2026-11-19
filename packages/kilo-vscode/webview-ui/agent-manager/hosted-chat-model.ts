import type { OpenCodeClient } from "@opencode/client"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { SessionMessage } from "@opencode/schema/session-message"
import { batch, createSignal } from "solid-js"
import type { PromptAttachment } from "../../src/protocol"
import { stageCloudImages } from "./cloud/attachments"
import { cloudCommands } from "./cloud/commands"

type Lease = { target: KiloHostedRpc.Target; attachmentID: string }
type Connection = { controller: AbortController; lease?: Lease }

/** A mounted Cloud transcript owns one lease. The directory selects the account's RPC Location, never the execution target. */
export function createHostedChat(client: OpenCodeClient, directory: string, target: KiloHostedRpc.Target) {
  const rpc = client.rpc(KiloHostedRpc.Definition)
  const location = { directory }
  const [snapshot, setSnapshot] = createSignal<KiloHostedRpc.Snapshot>()
  const [earlier, setEarlier] = createSignal<{ messages: readonly KiloHostedRpc.Message[]; before?: string }>()
  const [phase, setPhase] = createSignal<"opening" | "registering" | "ready" | "reconnecting" | "failed">("opening")
  const [reason, setReason] = createSignal<string>()
  const [draft, setDraft] = createSignal("")
  const [pending, setPending] = createSignal(false)
  const [commands, setCommands] = createSignal(cloudCommands())
  let catalogAt = 0
  const [paging, setPaging] = createSignal(false)
  const [failure, setFailure] = createSignal<"prompt" | "request">()
  const [answered, setAnswered] = createSignal<string[]>([])
  const [dismissed, setDismissed] = createSignal<string[]>([])
  const [submitted, setSubmitted] = createSignal(new Map<string, string>())
  let outgoing: { text: string; messageID: string; imageKey: string } | undefined
  let active: Connection | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let failures = 0

  const before = () => (earlier() ? earlier()?.before : snapshot()?.before)
  const busy = () => snapshot()?.status === "busy" || snapshot()?.status === "retry"
  const live = () => snapshot()?.connection === "live"
  const questions = () => snapshot()?.questions.filter((item) => !answered().includes(item.id)) ?? []
  const permissions = () => snapshot()?.permissions.filter((item) => !answered().includes(item.id)) ?? []
  const canSend = (hasImages = false) =>
    phase() === "ready" && !pending() && !questions().length && !permissions().length && (!!draft().trim() || hasImages)

  function accept(message: { text: string; messageID: string }) {
    if (outgoing?.messageID !== message.messageID) return
    outgoing = undefined
    if (draft().trim() === message.text) setDraft("")
    if (failure() === "prompt") setFailure(undefined)
  }

  function replace(next: KiloHostedRpc.Snapshot) {
    batch(() => {
      // Keep fetched pages contiguous when the live window advances while someone reads earlier messages.
      const history = earlier()
      const previous = snapshot()?.messages
      if (history && previous && previous[0]?.id !== next.messages[0]?.id) {
        const overlap = previous.findIndex((message) => message.id === next.messages[0]?.id)
        setEarlier(
          overlap < 0 ? undefined : { ...history, messages: [...history.messages, ...previous.slice(0, overlap)] },
        )
      }
      setSnapshot(next)
      setDismissed((ids) => ids.filter((id) => next.queued?.includes(id)))
      setReason(undefined)
      setPhase("ready")
      setAnswered((ids) =>
        ids.filter((id) => next.questions.some((q) => q.id === id) || next.permissions.some((p) => p.id === id)),
      )
      if (outgoing && next.messages.some((message) => message.id === outgoing?.messageID)) accept(outgoing)
    })
  }

  function detach(lease: Lease) {
    // Cleanup must not reuse the aborted read signal or interrupt a running Cloud job.
    void rpc.detach(lease, { location }).catch(() => {})
  }

  function disconnect() {
    clearTimeout(timer)
    const old = active
    active = undefined
    old?.controller.abort()
    if (old?.lease) detach(old.lease)
    batch(() => {
      setAnswered([])
      setPaging(false)
      setPending(false)
      setFailure(undefined)
    })
  }

  async function watch(connection: Connection) {
    const options = { location, signal: connection.controller.signal }
    const { attachmentID } = await rpc.attach({ target }, options)
    const lease = { attachmentID, target }
    if (active !== connection) return detach(lease)
    connection.lease = lease
    let revision: number | undefined
    while (active === connection) {
      const page = await rpc.read({ ...lease, revision, incremental: true }, options)
      if (active !== connection) return
      revision = page.revision
      if (page.snapshot) replace(page.order ? assembleSnapshot(snapshot(), page.snapshot, page.order) : page.snapshot)
      failures = 0
    }
  }

  function open() {
    disconnect()
    const connection = { controller: new AbortController() }
    active = connection
    if (phase() !== "registering") setPhase(failures ? "reconnecting" : "opening")
    void watch(connection).catch((error) => {
      if (active !== connection) return
      disconnect()
      if (error?.type === "HostedPreparing") {
        setPhase("registering")
        timer = setTimeout(open, 1500)
        return
      }
      // A rejected lease can mean revoked access. Never retain its private pages across another attach.
      // A transport interruption, in contrast, can keep the last verified view while reconnecting.
      if (error && typeof error === "object" && error.type === "HostedError") {
        setReason(error.message)
        setSnapshot(undefined)
        setEarlier(undefined)
      }
      failures++
      if (failures > 3) return setPhase("failed")
      setPhase("reconnecting")
      timer = setTimeout(open, 1000 * 2 ** (failures - 1))
    })
  }

  async function act(
    kind: "prompt" | "request",
    run: (lease: Lease, options: { location: { directory: string }; signal: AbortSignal }) => Promise<unknown>,
    requestID?: string,
  ) {
    const connection = active
    if (!connection?.lease || pending() || phase() !== "ready") return false
    setPending(true)
    setFailure(undefined)
    try {
      await run(connection.lease, { location, signal: connection.controller.signal })
      if (connection !== active) return false
      if (requestID) setAnswered((ids) => [...ids, requestID])
      return true
    } catch (error) {
      if (connection === active) {
        setFailure(kind)
        setReason(
          error &&
            typeof error === "object" &&
            "type" in error &&
            error.type === "HostedError" &&
            "message" in error &&
            typeof error.message === "string"
            ? error.message
            : undefined,
        )
      }
      return false
    } finally {
      if (connection === active) setPending(false)
    }
  }

  async function send(
    selection?: { agent?: string; model?: string },
    items: readonly PromptAttachment[] = [],
    command?: { name: string; args: string },
    stopFirst = false,
  ) {
    if (!canSend(items.length > 0)) return
    const text = draft().trim()
    const imageKey = JSON.stringify(items.map((i) => i.id))
    if (!outgoing || outgoing.text !== text || outgoing.imageKey !== imageKey)
      outgoing = { text, imageKey, messageID: SessionMessage.ID.create() }
    const message = outgoing
    setSubmitted((prev) => {
      const next = new Map(prev)
      if (next.size >= 32) next.delete(next.keys().next().value!)
      return next.set(message.messageID, text)
    })
    const accepted = await act("prompt", async (lease, options) => {
      if (stopFirst && busy() && live()) await rpc.interrupt(lease, options)
      if (command) {
        if (items.length) throw { type: "HostedError", message: "Cloud commands cannot include attachments." }
        return rpc.command(
          { ...lease, messageID: message.messageID, command: command.name, arguments: command.args, ...selection },
          options,
        )
      }
      const attachments = await stageCloudImages(
        client,
        directory,
        target.scope,
        message.messageID,
        items,
        options.signal,
      )
      return rpc.prompt(
        { ...lease, messageID: message.messageID, text, ...selection, ...(attachments && { attachments }) },
        options,
      )
    })
    if (accepted) accept(message)
    return accepted
  }

  async function loadEarlier() {
    const connection = active
    const cursor = before()
    if (!cursor || !connection?.lease || paging()) return
    setPaging(true)
    setFailure(undefined)
    try {
      const page = await rpc.history(
        { ...connection.lease, before: cursor },
        { location, signal: connection.controller.signal },
      )
      if (connection === active && cursor === before()) {
        setEarlier({ before: page.before, messages: [...page.messages, ...(earlier()?.messages ?? [])] })
      }
    } catch {
      if (active === connection) setFailure("request")
    } finally {
      if (active === connection) setPaging(false)
    }
  }

  return {
    snapshot,
    phase,
    reason,
    draft,
    setDraft,
    failure,
    pending,
    paging,
    busy,
    live,
    before,
    questions,
    permissions,
    canSend,
    messages: () => {
      const page = earlier()?.messages ?? []
      const recent = snapshot()?.messages ?? []
      if (!page.length) return recent
      const latestIDs = new Set(recent.map((item) => item.id))
      return [...page.filter((item) => !latestIDs.has(item.id)), ...recent]
    },
    open,
    close() {
      disconnect()
      setSnapshot(undefined)
      setEarlier(undefined)
    },
    loadEarlier,
    async previewLink(port: number, path: string) {
      const connection = active
      if (!connection?.lease) return
      const result = await rpc.openPreview({ target, port, path }, { location, signal: connection.controller.signal })
      if (connection === active) return result.url
    },
    async childHistory(childID: string, signal: AbortSignal, before?: string) {
      const connection = active
      if (!connection?.lease) throw new Error("Session is not attached")
      return rpc.childHistory(
        { ...connection.lease, childID, before },
        { location, signal: AbortSignal.any([signal, connection.controller.signal]) },
      )
    },
    send,
    queued: () => snapshot()?.queued?.filter((id) => !dismissed().includes(id)) ?? [],
    queueText: (id: string) => submitted().get(id),
    commands,
    discover() {
      const connection = active
      if (!connection?.lease || Date.now() - catalogAt < 30_000) return
      catalogAt = Date.now()
      void rpc
        .commands({ target }, { location, signal: connection.controller.signal })
        .then((result) => {
          if (connection === active) setCommands(cloudCommands(result.commands))
        })
        .catch(() => {})
    },
    cancelQueued: (messageID: string) =>
      act("request", async (_, options) => {
        const result = await rpc.cancelQueued({ target, messageID }, options)
        if (!options.signal.aborted && result.dropped) setDismissed((ids) => [...ids, messageID])
      }),
    retry() {
      failures = 0
      open()
    },
    interrupt() {
      if (busy() && live()) return act("request", rpc.interrupt)
    },
    question(id: string, answers?: string[][]) {
      if (!live() || !questions().some((q) => q.id === id)) return
      return act(
        "request",
        (lease, options) =>
          answers
            ? rpc.replyQuestion({ ...lease, requestID: id, answers }, options)
            : rpc.rejectQuestion({ ...lease, requestID: id }, options),
        id,
      )
    },
    permission(id: string, reply: "once" | "always" | "reject") {
      if (!live() || !permissions().some((p) => p.id === id)) return
      return act("request", (lease, options) => rpc.replyPermission({ ...lease, requestID: id, reply }, options), id)
    },
  }
}

export type HostedChatModel = ReturnType<typeof createHostedChat>

/** Preserve identities of settled turns, including tool expansion and selection, while text deltas arrive. */
function assembleSnapshot(
  previous: KiloHostedRpc.Snapshot | undefined,
  next: KiloHostedRpc.Snapshot,
  order: readonly string[],
) {
  const rows = new Map(previous?.messages.map((m) => [m.id, m]))
  for (const m of next.messages) rows.set(m.id, m)
  return {
    ...next,
    messages: order.map((id) => {
      const m = rows.get(id)
      if (!m) throw new Error("Cloud stream needs a new snapshot")
      return m
    }),
  }
}
