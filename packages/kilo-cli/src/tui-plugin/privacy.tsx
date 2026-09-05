import { createClient, type RpcCallOptions } from "@kilocode/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import { createSignal, type Accessor } from "solid-js"
import { PrivacyRpc, type PrivacyState } from "../privacy-rpc"

export type PrivacyUiClient = Pick<ReturnType<typeof createClient>, "rpc">

export type PrivacyUiOptions = {
  readonly client?: PrivacyUiClient
  readonly signal?: AbortSignal
}

export type PrivacyUi = {
  /** Starts true so a persisted opt-in cannot briefly reveal account labels while it loads. */
  readonly enabled: Accessor<boolean>
  /** Ask before showing account fields when privacy mode is active. */
  readonly confirmProfileReveal: () => Promise<boolean>
}

export function privacyUiRequestOptions(
  ctx: Pick<Plugin.Context, "location" | "data">,
  signal?: AbortSignal,
): RpcCallOptions {
  const ref = ctx.location ?? ctx.data.location.default()
  return {
    ...(signal ? { signal } : {}),
    location: {
      directory: ref.directory,
      ...(ref.workspaceID === undefined ? {} : { workspace: ref.workspaceID }),
    },
  }
}

export type PrivacyCommand = { readonly enabled: boolean } | { readonly kind: "usage"; readonly reason: string }

export function parsePrivacyCommand(input?: string): PrivacyCommand {
  const value = input?.trim()
  if (value === "on") return { enabled: true }
  if (value === "off") return { enabled: false }
  return { kind: "usage", reason: "Run /privacy on or /privacy off." }
}

/** Register profile-only privacy controls and return the reactive state for Kilo-owned UI. */
export function installPrivacyUi(ctx: Plugin.Context, options: PrivacyUiOptions = {}): PrivacyUi {
  const rpc = options.client?.rpc(PrivacyRpc.Definition)
  const [enabled, setEnabled] = createSignal(true)
  let observedChange = false
  if (rpc) {
    rpc.events.on(
      "updated",
      (event) => {
        observedChange = true
        setEnabled(event.data.enabled)
      },
      { signal: options.signal },
    )
  }
  const initial = load()

  ctx.keymap.layer(() => ({
    mode: "global",
    priority: 2,
    commands: [
      {
        id: "kilo.privacy",
        title: "Privacy mode",
        description: "Hide Kilo account labels in this isolated profile",
        group: "Kilo",
        bind: false,
        palette: true,
        suggested: true,
        slash: { name: "privacy", arguments: true },
        run: async (input?: string) => {
          if (options.signal?.aborted) return
          const parsed = parsePrivacyCommand(input)
          if ("kind" in parsed) {
            await ctx.ui.dialog.alert({ title: "Privacy mode", message: parsed.reason })
            return
          }
          if (!rpc) {
            await ctx.ui.dialog.alert({
              title: "Privacy mode",
              message: "Restart this preview to enable isolated privacy controls.",
            })
            return
          }
          try {
            await initial
            const value = await rpc.set(
              { enabled: parsed.enabled },
              privacyUiRequestOptions(ctx, options.signal),
            )
            setEnabled(value.enabled)
            ctx.ui.toast.show({
              title: "Privacy mode",
              message: `${value.enabled ? "Enabled" : "Disabled"} for this isolated Kilo profile.`,
              variant: "success",
            })
          } catch (error) {
            if (options.signal?.aborted) return
            await ctx.ui.dialog.alert({ title: "Privacy mode failed", message: message(error) })
          }
        },
      },
    ],
  }))

  return { enabled, confirmProfileReveal }

  async function confirmProfileReveal() {
    await initial
    if (!enabled()) return true
    return (
      (await ctx.ui.dialog.confirm({
        title: "Reveal Kilo account details?",
        message:
          "Privacy mode is on. This will show your Kilo email, name, and organization details in this TUI.",
        label: { confirm: "reveal", cancel: "keep hidden" },
      })) === true
    )
  }

  async function load() {
    if (!rpc) {
      setEnabled(false)
      return
    }
    try {
      const value: PrivacyState = await rpc.read({}, privacyUiRequestOptions(ctx, options.signal))
      if (!observedChange) setEnabled(value.enabled)
    } catch {
      // Keep the initial hidden state if the isolated preference cannot be read.
      if (!observedChange) setEnabled(true)
    }
  }
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  return "Unable to complete the Kilo privacy operation"
}
