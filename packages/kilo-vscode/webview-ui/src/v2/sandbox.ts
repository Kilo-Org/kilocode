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
import { failureHandling, mergeStatus, type SandboxStatus } from "./sandbox-status"

export type SandboxSupport = KiloSandboxRpc.Support

/** The draft preference from the host: `explicit` is absent when the user has not chosen a default. */
type Preference = { explicit?: boolean }

const RETRY = 1000

// What the last composer for a directory learned about the sandbox. The Agent Manager mounts one composer per
// worktree and disposes it on every switch, so a remount shows the known state instead of hiding the lock until the
// reads answer again. A different worktree has its own directory, so it starts empty like before.
type Remembered = {
  preference?: Preference
  support?: SandboxSupport
  unsupported?: boolean
  statuses: Record<string, SandboxStatus>
}
const remembered = new Map<string, Remembered>()

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
  const directory = v2.directory
  const location = { directory }
  const saved = remembered.get(directory)
  const [preference, setPreference] = createSignal<Preference | undefined>(saved?.preference)
  const [support, setSupport] = createSignal<SandboxSupport | undefined>(saved?.support)
  const [statuses, setStatuses] = createSignal<Record<string, SandboxStatus>>(saved?.statuses ?? {})
  const [pending, setPending] = createSignal(false)
  // Each read owns a token, so a late answer for another session cannot replace the current state.
  let reads = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  let attempts = 0

  // Every answer is kept for the next composer of this directory.
  const remember = (patch: Partial<Remembered>) => {
    const current = remembered.get(directory)
    remembered.set(directory, {
      ...current,
      statuses: { ...current?.statuses, ...statuses() },
      ...patch,
    })
  }
  const storeStatus = (sessionID: string, value: SandboxStatus) => {
    const next = mergeStatus(statuses(), sessionID, value)
    setStatuses(next)
    remember({ statuses: next })
  }

  const waiters: (() => void)[] = []
  // A server without the sandbox plugin fails `support`; the first prompt must not wait for it.
  let unsupported = saved?.unsupported ?? false
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
    remember({ preference: { explicit: message.explicit } })
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
        remember({ support: value, unsupported: false })
        settle()
      })
      .catch(() => {
        unsupported = true
        setSupport(undefined)
        remember({ support: undefined, unsupported: true })
        settle()
      })
  }

  const toast = (message: string) =>
    showToast({ variant: "error", title: language.t("common.requestFailed"), description: message })

  const read = async (sessionID: string) => {
    const token = ++reads
    try {
      // A failed create or metadata write is reported by the prompt; the status read still answers.
      await Promise.resolve(input.gate?.(sessionID)).catch(() => undefined)
      const value = await rpc.status({ sessionID }, { location })
      if (token !== reads || input.session() !== sessionID) return
      attempts = 0
      storeStatus(sessionID, value)
    } catch (error: unknown) {
      if (token !== reads) return
      const handling = failureHandling(error)
      // The sandbox is optional, so a server without the plugin must not report a failure on every session view.
      if (handling === "unsupported") return
      if (handling === "retry") {
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
    storeStatus(data.sessionID, data)
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
        remember({ preference: { explicit: next } })
        post({ type: "persistSandboxDefault", enabled: next })
        return
      }
      setPending(true)
      try {
        const value = await rpc.toggle({ sessionID: id }, { location })
        storeStatus(id, value)
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
