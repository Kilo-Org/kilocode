// Sandbox state for the composer, on the `kilocode.sandbox` RPC. An existing session reads `status` and follows the
// `changed` event; a draft uses the host preference for new sessions, or the configured default from `support`. The
// first status read of a new session waits for the create gate, because the session metadata is written right after
// create and seeds the state.
import { KiloSandboxRpc } from "@opencode/schema/kilocode/sandbox"
import { showToast } from "@kilocode/kilo-ui/toast"
import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import type { ToHost } from "../../../src/protocol"
import { useLanguage } from "../context/language"
import { useVSCode } from "../context/vscode"
import { sandboxControls } from "../components/settings/sandboxing"
import { useV2 } from "./client"
import { mergeStatus, type SandboxStatus } from "./sandbox-status"

export type SandboxSupport = KiloSandboxRpc.Support

/** The draft preference from the host: `explicit` is absent when the user has not chosen a default. */
type Preference = { explicit?: boolean }

const RETRY = 1000

function reason(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message
  return String(error)
}

export function createSandbox(input: {
  session: Accessor<string | undefined>
  /** Waits for a new session to exist and carry its sandbox metadata before the first status read. */
  gate?: (sessionID: string) => Promise<unknown> | undefined
}) {
  const v2 = useV2()
  const vscode = useVSCode()
  const language = useLanguage()
  const rpc = v2.api.rpc(KiloSandboxRpc.Definition)
  const location = { directory: v2.directory }
  const [preference, setPreference] = createSignal<Preference>()
  const [support, setSupport] = createSignal<SandboxSupport>()
  const [statuses, setStatuses] = createSignal<Record<string, SandboxStatus>>({})
  const [pending, setPending] = createSignal(false)
  // Each read owns a token, so a late answer for another session cannot replace the current state.
  let reads = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  let attempts = 0

  const waiters: (() => void)[] = []
  // A server without the sandbox plugin fails `support`; the first prompt must not wait for it.
  let unsupported = false
  const settle = () => {
    if (preference() && (support() || unsupported)) for (const resolve of waiters.splice(0)) resolve()
  }
  const defaultsReady = () =>
    new Promise<void>((resolve) => {
      waiters.push(resolve)
      settle()
    })
  const desired = () => preference()?.explicit ?? support()?.enabled ?? false

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "sandboxDefaultLoaded") return
    setPreference({ explicit: message.explicit })
    settle()
  })
  onCleanup(unsubscribe)

  const post = (message: ToHost) => vscode.postMessage(message as never)

  const readSupport = () => {
    void rpc
      .support({}, { location })
      .then((value) => {
        unsupported = false
        setSupport(value)
        settle()
      })
      .catch(() => {
        unsupported = true
        setSupport(undefined)
        settle()
      })
  }

  const toast = (message: string) =>
    showToast({ variant: "error", title: language.t("common.requestFailed"), description: message })

  const read = async (sessionID: string) => {
    const token = ++reads
    try {
      await input.gate?.(sessionID)
      const value = await rpc.status({ sessionID }, { location })
      if (token !== reads || input.session() !== sessionID) return
      attempts = 0
      setStatuses((current) => mergeStatus(current, sessionID, value))
    } catch (error: unknown) {
      if (token !== reads) return
      if ((error as { type?: string } | undefined)?.type === "not_found") {
        // A just-created session can still be missing for a moment, so retry a few times.
        if (attempts >= 2) return
        attempts++
        if (retry) clearTimeout(retry)
        retry = setTimeout(() => {
          retry = undefined
          if (input.session() === sessionID) void read(sessionID)
        }, RETRY)
        return
      }
      toast(reason(error))
    }
  }

  const requestDefaults = () => post({ type: "requestSandboxDefault" })

  const subscribe = rpc.events.on("changed", (event) => {
    const data = event.data
    setStatuses((current) => mergeStatus(current, data.sessionID, data))
  })
  onCleanup(subscribe)
  onCleanup(() => {
    if (retry) clearTimeout(retry)
  })

  createEffect(
    on(
      () => [input.session(), v2.connection.status()] as const,
      ([id, status]) => {
        if (status !== "connected") return
        attempts = 0
        readSupport()
        if (!id) {
          requestDefaults()
          return
        }
        void read(id)
      },
      { defer: false },
    ),
  )

  // A config write reloads the documents on the server; read the default and the session state again.
  onCleanup(
    v2.data.on("config.updated", () => {
      readSupport()
      const id = input.session()
      if (id) void read(id)
    }),
  )

  const current = () => {
    const id = input.session()
    return id ? statuses()[id] : undefined
  }

  return {
    visible: () => sandboxControls() && support()?.enabled === true,
    ready: () => (input.session() ? current() !== undefined : preference() !== undefined && support() !== undefined),
    enabled: () => {
      if (input.session()) return current()?.enabled ?? false
      return desired() && (support()?.available ?? false)
    },
    available: () => (input.session() ? current()?.available : support()?.available),
    reason: () => (input.session() ? current()?.reason : support()?.reason),
    network: () => (input.session() ? (current()?.network ?? true) : (support()?.network ?? true)),
    disabled: () =>
      v2.connection.status() !== "connected" ||
      pending() ||
      (input.session() ? current() === undefined : preference() === undefined) ||
      (input.session() ? current()?.available === false : support() === undefined || support()?.available === false),
    toggle: async () => {
      const id = input.session()
      if (!id) {
        const next = !desired()
        setPreference({ explicit: next })
        post({ type: "persistSandboxDefault", enabled: next })
        return
      }
      setPending(true)
      try {
        const value = await rpc.toggle({ sessionID: id }, { location })
        setStatuses((current) => mergeStatus(current, id, value))
      } catch (error: unknown) {
        toast(reason(error))
      } finally {
        setPending(false)
      }
    },
    /** The session metadata for the first prompt. */
    async metadata() {
      if (!preference()) requestDefaults()
      if (!support()) readSupport()
      await defaultsReady()
      return { "kilocode.sandbox": { enabled: desired(), version: 0 } }
    },
  }
}

export type Sandbox = ReturnType<typeof createSandbox>
