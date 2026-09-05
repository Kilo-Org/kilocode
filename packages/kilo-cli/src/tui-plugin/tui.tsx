import { createClient, type KiloGatewayAccount } from "@kilocode/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import { Option, Schema } from "effect"
import { createMemo, createSignal } from "solid-js"
import { KiloLogo } from "./logo"
import { installMemoryUi } from "./memory"
import { installMemorySidebar } from "./sidebar-memory"
import { installIndexingSidebar } from "./sidebar-indexing"
import { installRoutedModelSidebar } from "./sidebar-routed-model"
import { installUsageSidebar } from "./sidebar-usage"
import { installAccountSidebar } from "./sidebar-account"
import { installSettingsUi } from "./settings"
import { installRemoteUi } from "./remote"
import { installPrivacyUi, type PrivacyUi } from "./privacy"

const Options = Schema.Struct({
  kiloHttp: Schema.optional(
    Schema.Struct({ baseUrl: Schema.String, headers: Schema.Record(Schema.String, Schema.String) }),
  ),
})
const failure = Schema.decodeUnknownOption(
  Schema.Struct({ message: Schema.String, kind: Schema.optional(Schema.String) }),
)

export default Plugin.define({
  id: "kilo.preview",
  setup(ctx) {
    ctx.ui.slot({
      replace: "home.logo",
      render: () => <KiloLogo fg={ctx.theme.text.logo} bg={ctx.theme.background.default} />,
    })
    const options = Schema.decodeUnknownSync(Options)(ctx.options ?? {})
    const client = options.kiloHttp ? createClient(options.kiloHttp) : undefined
    const controller = new AbortController()
    const [account, setAccount] = createSignal<KiloGatewayAccount>()
    const [privacy, setPrivacy] = createSignal<PrivacyUi>()
    const [revision, setRevision] = createSignal(0)
    const refresh = async () => {
      if (!client) throw new Error("Restart this preview to enable Kilo account controls")
      const current = revision() + 1
      setRevision(current)
      try {
        const value = await client.kilocode.profile({ signal: controller.signal })
        if (current === revision()) setAccount(value)
        return value
      } catch (error) {
        if (current === revision()) setAccount(undefined)
        throw error
      }
    }
    const label = createMemo(() => {
      const value = account()
      if (!value) return "Connect Kilo to sign in · /teams"
      if (!value.selectionAvailable) return "Kilo account selection unavailable · /teams"
      if (privacy()?.enabled() !== false) return "Kilo account hidden · /teams"
      const name =
        value.currentOrganizationID === null
          ? "Personal account"
          : (value.profile.organizations.find((organization) => organization.id === value.currentOrganizationID)
              ?.name ?? value.currentOrganizationID)
      return `${name}${value.profile.email ? ` · ${value.profile.email}` : ""} · /teams`
    })
    ctx.ui.slot({
      append: "home.footer",
      render: () => (
        <text fg={ctx.theme.text.default}>Kilo internal preview · isolated interactive store · {label()}</text>
      ),
    })
    ctx.ui.slot({
      append: "app",
      render: () => {
        installMemoryUi(ctx, { client, signal: controller.signal })
        installMemorySidebar(ctx, { client, signal: controller.signal })
        installIndexingSidebar(ctx, { client, signal: controller.signal })
        installRoutedModelSidebar(ctx)
        installSettingsUi(ctx, { client, signal: controller.signal })
        installRemoteUi(ctx, { client, signal: controller.signal })
        setPrivacy(installPrivacyUi(ctx, { client, signal: controller.signal }))
        installUsageSidebar(ctx, {
          client,
          privacy: () => privacy()?.enabled() ?? true,
          signal: controller.signal,
        })
        installAccountSidebar(ctx, {
          client,
          account,
          privacy: () => privacy()?.enabled() ?? true,
          revision,
          signal: controller.signal,
        })
        ctx.keymap.layer(() => ({
          mode: "global",
          // Upstream registers placeholder sharing commands at the default priority.
          priority: 1,
          commands: [
            {
              id: "kilo.teams",
              title: "Switch Kilo account",
              group: "Kilo",
              palette: true,
              slash: { name: "teams", aliases: ["team", "org"] },
              run: async () => {
                if (!client) {
                  ctx.ui.toast.show({
                    message: "Restart this preview to enable Kilo account controls",
                    variant: "info",
                  })
                  return
                }
                try {
                  if (!(await privacy()?.confirmProfileReveal())) return
                  const current = await refresh()
                  const choices = [
                    ...(current.profile.hasPersonalAccount === false
                      ? []
                      : [{ title: "Personal account", value: null }]),
                    ...current.profile.organizations.map((organization) => ({
                      title: organization.name,
                      value: organization.id,
                      ...(organization.role ? { description: organization.role } : {}),
                    })),
                  ]
                  if (!choices.length) throw new Error("No Kilo accounts are available")
                  const selected = await ctx.ui.dialog.select<string | null>({
                    title: "Switch Kilo account",
                    placeholder: "Select personal account or organization",
                    options: choices,
                    current: current.selectionAvailable ? current.currentOrganizationID : undefined,
                  })
                  if (selected === undefined) return
                  const value = await client.kilocode.organization.set(
                    { organizationID: selected },
                    { signal: controller.signal },
                  )
                  setRevision((value) => value + 1)
                  setAccount(value)
                  ctx.ui.toast.show({ message: "Kilo account switched", variant: "success" })
                } catch (error) {
                  if (controller.signal.aborted) return
                  const decoded = failure(error)
                  await refresh().catch(() => undefined)
                  ctx.ui.toast.show({
                    title: "Kilo account",
                    message: Option.isSome(decoded)
                      ? decoded.value.message
                      : error instanceof Error
                        ? error.message
                        : "Unable to switch Kilo account",
                    variant: "error",
                  })
                }
              },
            },
            {
              id: "kilo.profile",
              title: "Kilo account profile",
              group: "Kilo",
              palette: true,
              slash: { name: "profile" },
              run: async () => {
                if (!(await privacy()?.confirmProfileReveal())) return
                try {
                  const current = await refresh()
                  const organization = current.profile.organizations.find(
                    (item) => item.id === current.currentOrganizationID,
                  )
                  await ctx.ui.dialog.alert({
                    title: "Kilo account profile",
                    message: [
                      current.profile.name,
                      current.profile.email,
                      !current.selectionAvailable
                        ? "Account selection unavailable"
                        : current.currentOrganizationID === null
                          ? "Personal account"
                          : organization?.name,
                    ]
                      .filter(Boolean)
                      .join("\n"),
                  })
                } catch (error) {
                  if (controller.signal.aborted) return
                  ctx.ui.toast.show({
                    title: "Kilo profile",
                    message: message(error, "Unable to read Kilo profile"),
                    variant: "error",
                  })
                }
              },
            },
            {
              id: "session.share",
              title: "Share session publicly",
              description: "Upload this session transcript and create a public Kilo share",
              group: "Session",
              bind: false,
              palette: true,
              suggested: true,
              slash: { name: "share" },
              run: async () => {
                const target = sessionID(ctx, "sharing")
                if (!target) return
                if (!client) {
                  ctx.ui.toast.show({
                    message: "Restart this preview to enable Kilo session sharing",
                    variant: "info",
                  })
                  return
                }
                const confirmed = await ctx.ui.dialog.confirm({
                  title: "Share session publicly",
                  message:
                    "This uploads the session transcript, tool output, attachments, and local paths to Kilo and makes it publicly accessible. Continue?",
                  label: { confirm: "share", cancel: "cancel" },
                })
                if (confirmed !== true) return
                try {
                  const shared = await client.kilocode.session.share(
                    { sessionID: target },
                    { signal: controller.signal },
                  )
                  const copied = ctx.renderer.copyToClipboardOSC52(shared.url)
                  ctx.ui.toast.show({
                    title: "Session shared",
                    message: copied ? "Public share URL copied to clipboard" : `Public share URL: ${shared.url}`,
                    variant: "success",
                  })
                } catch (error) {
                  if (controller.signal.aborted) return
                  ctx.ui.toast.show({
                    title: "Session sharing failed",
                    message: message(error, "Unable to share this session"),
                    variant: "error",
                  })
                }
              },
            },
            {
              id: "session.unshare",
              title: "Unshare session",
              description: "Remove the public Kilo share for this session",
              group: "Session",
              bind: false,
              palette: true,
              slash: { name: "unshare" },
              run: async () => {
                const target = sessionID(ctx, "unsharing")
                if (!target) return
                if (!client) {
                  ctx.ui.toast.show({
                    message: "Restart this preview to enable Kilo session sharing",
                    variant: "info",
                  })
                  return
                }
                try {
                  await client.kilocode.session.unshare({ sessionID: target }, { signal: controller.signal })
                  ctx.ui.toast.show({ message: "Session unshared", variant: "success" })
                } catch (error) {
                  if (controller.signal.aborted) return
                  ctx.ui.toast.show({
                    title: "Session unsharing failed",
                    message: message(error, "Unable to unshare this session"),
                    variant: "error",
                  })
                }
              },
            },
            {
              id: "kilo.session.fork-from-share",
              title: "Fork from shared session",
              description: "Import a Kilo public share as a new session",
              group: "Kilo",
              bind: false,
              palette: true,
              slash: { name: "fork-from-share", aliases: ["fork-share"], arguments: true },
              run: async (input?: string) => {
                if (!client) {
                  ctx.ui.toast.show({
                    message: "Restart this preview to enable Kilo session sharing",
                    variant: "info",
                  })
                  return
                }
                const value =
                  input?.trim() ||
                  (
                    await ctx.ui.dialog.prompt({
                      title: "Fork from shared session",
                      description: "Paste a Kilo public share URL or token.",
                      placeholder: "https://app.kilo.ai/s/...",
                    })
                  )?.trim()
                if (!value) return
                try {
                  const fork = await client.kilocode.session.fork(
                    {
                      share: value,
                      ...(ctx.location ? { location: ctx.location } : {}),
                    },
                    { signal: controller.signal },
                  )
                  ctx.ui.router.navigate({ type: "session", sessionID: fork.id })
                  ctx.ui.toast.show({ message: "Forked shared session", variant: "success" })
                } catch (error) {
                  if (controller.signal.aborted) return
                  ctx.ui.toast.show({
                    title: "Shared session fork failed",
                    message: message(error, "Unable to fork the shared session"),
                    variant: "error",
                  })
                }
              },
            },
          ],
        }))
        return null
      },
    })
    if (client) void refresh().catch(() => undefined)
    void (async () => {
      if (!client) return
      for await (const event of client.event.subscribe({ signal: controller.signal })) {
        if (
          event.type === "credential.updated" ||
          (event.type === "credential.switched" && event.data.integrationID === "kilo")
        ) {
          setAccount(undefined)
          await refresh().catch(() => undefined)
        }
      }
    })().catch(() => undefined)
    return () => controller.abort()
  },
})

function sessionID(ctx: Plugin.Context, action: string) {
  const route = ctx.ui.router.current()
  if (route.type === "session") return route.sessionID
  ctx.ui.toast.show({ message: `Open a session before ${action}`, variant: "info" })
  return undefined
}

function message(error: unknown, fallback: string) {
  const decoded = failure(error)
  if (Option.isSome(decoded)) return decoded.value.message
  if (error instanceof Error) return error.message
  return fallback
}
