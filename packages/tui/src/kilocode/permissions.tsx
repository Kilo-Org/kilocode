import { dict } from "@kilocode/kilo-i18n/en"
import type { LocationRef, PermissionRequest } from "@opencode/client"
import { KiloPermissionsRpc } from "@opencode/schema/kilocode/permissions"
import type { Preset, PresetID } from "@opencode/schema/kilocode/permissions"
import type { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useTheme } from "../context/theme"
import { PermissionPrompt, SessionQuestion } from "../routes/session/permission"

type CopyKey = Extract<keyof typeof dict, `tui.permissions.${string}`>

type ControllerState =
  | { readonly status: "idle" }
  | { readonly status: "checking"; readonly requestID?: string; readonly sessionID?: string }
  | {
      readonly status: "offer"
      readonly requestID?: string
      readonly sessionID?: string
      readonly projectID: string
      readonly location: LocationRef
      readonly presets: readonly Preset[]
      readonly applied: readonly Preset[]
    }
  | {
      readonly status: "submitting"
      readonly requestID?: string
      readonly sessionID?: string
      readonly projectID: string
      readonly location: LocationRef
      readonly action: Decision
    }
  | { readonly status: "normal"; readonly projectID?: string }

type Decision = "apply" | "skip" | "clear"

type Offer = Extract<ControllerState, { status: "offer" }>

type LoadResult = Offer | "active" | "disabled" | "no_matches" | "failed" | undefined

type Controller = {
  readonly state: () => ControllerState
  readonly ensure: (request: PermissionRequest) => void
  readonly manual: (location: LocationRef, sessionID?: string) => Promise<LoadResult>
  readonly decide: (decision: Decision, presetID?: PresetID) => void
}
// Sets applied to each project, keyed by project ID; the sidebar shows them while any are applied.
type Applied = {
  readonly get: (projectID: string) => readonly Preset[]
  readonly refresh: (location: LocationRef) => Promise<string | undefined>
  readonly dispose: () => void
}
type Navigation = {
  readonly move: (delta: number) => void
  readonly scroll: (delta: number) => void
}

export default definePlugin()

function t(key: CopyKey) {
  return dict[key]
}

function presetLabel(id: PresetID) {
  return t(`tui.permissions.preset.${id}`)
}

function presetDescription(id: PresetID) {
  if (id.startsWith("kilo-")) return t("tui.permissions.kiloDescription")
  if (id.endsWith("-install")) return t("tui.permissions.installDescription")
  return t("tui.permissions.checksDescription")
}

function definePlugin(): Plugin.Definition {
  return {
    id: "kilocode.permissions.tui",
    setup(context) {
      const controllers = new Map<string, Controller>()
      const byProject = new Map<string, Controller>()
      const [navigation, setNavigation] = createSignal<Navigation>()
      const applied = createApplied(context)
      const controller = (directory: string) => {
        const existing = controllers.get(directory)
        if (existing) return existing
        const created = createController(context, byProject, applied)
        controllers.set(directory, created)
        return created
      }
      const open = () => {
        void openManual(context, controller).catch((error) => {
          context.ui.toast.show({ variant: "error", message: String(error) })
        })
      }
      context.ui.slot({
        append: "sidebar.content",
        order: 230,
        render: (input) => (
          <SidebarPermissions context={context} applied={applied} sessionID={input.sessionID} open={open} />
        ),
      })
      context.ui.slot({
        replace: "session.permission",
        render(input) {
          const current = controller(
            input.directory ?? context.location?.directory ?? context.data.location.default().directory,
          )
          return (
            <PermissionGate
              controller={current}
              request={input.request}
              directory={input.directory}
              registerNavigation={setNavigation}
            />
          )
        },
      })

      context.ui.slot({
        append: "app",
        render() {
          context.keymap.layer(() => ({
            mode: "global",
            priority: 2,
            enabled: () => navigation() !== undefined,
            commands: [
              {
                id: "kilo.permissions.previous",
                bind: "up,k",
                title: "Previous permission set",
                run: () => navigation()?.move(-1),
              },
              {
                id: "kilo.permissions.next",
                bind: "down,j",
                title: "Next permission set",
                run: () => navigation()?.move(1),
              },
              {
                id: "kilo.permissions.pageup",
                bind: "pageup",
                title: "Scroll commands up",
                run: () => navigation()?.scroll(-1),
              },
              {
                id: "kilo.permissions.pagedown",
                bind: "pagedown",
                title: "Scroll commands down",
                run: () => navigation()?.scroll(1),
              },
            ],
          }))
          context.keymap.layer(() => ({
            mode: "global",
            commands: [
              {
                id: "kilo.permissions",
                title: t("tui.permissions.command.title"),
                description: t("tui.permissions.command.description"),
                palette: true,
                slash: { name: "permissions" },
                bind: false,
                run: open,
              },
            ],
          }))
          return null
        },
      })
      return applied.dispose
    },
  }
}

function createApplied(context: Plugin.Context): Applied {
  const [sets, setSets] = createStore<Record<string, readonly Preset[]>>({})
  const dispose = context.client.rpc(KiloPermissionsRpc.Definition).events.on("updated", (event) => {
    setSets(event.data.projectID, [...event.data.applied])
  })
  return {
    dispose,
    get: (projectID) => sets[projectID] ?? [],
    // A server without the permissions plugin answers with an error or no output, and the sidebar shows no sets.
    refresh: (location) =>
      context.client
        .rpc(KiloPermissionsRpc.Definition)
        .list({}, { location })
        .then((result) => {
          setSets(result.projectID, result.enabled ? [...result.applied] : [])
          return result.projectID
        })
        .catch(() => undefined),
  }
}

function createController(context: Plugin.Context, byProject: Map<string, Controller>, applied: Applied): Controller {
  const [state, setState] = createSignal<ControllerState>({ status: "idle" })
  let operation: Promise<void> | undefined

  // Applying a set settles the waiting requests it covers on the server; refresh the session's pending list.
  const sync = async (sessionID?: string) => {
    if (sessionID) await context.data.session.permission.sync(sessionID)
  }

  const fail = (message: CopyKey, projectID?: string) => {
    context.ui.toast.show({ variant: "error", message: t(message) })
    setState({ status: "normal", projectID })
  }

  const load = async (
    location: LocationRef,
    requestID: string | undefined,
    sessionID: string | undefined,
    manual: boolean,
  ): Promise<LoadResult> => {
    setState({ status: "checking", requestID, sessionID })
    try {
      const result = await context.client.rpc(KiloPermissionsRpc.Definition).list({}, { location })
      const current = byProject.get(result.projectID)
      if (!current) byProject.set(result.projectID, api)
      if (!result.enabled) {
        setState({ status: "normal", projectID: result.projectID })
        return manual ? "disabled" : undefined
      }
      if (result.presets.length === 0) {
        setState({ status: "normal", projectID: result.projectID })
        return manual ? "no_matches" : undefined
      }
      if (!manual && result.decision !== null) {
        setState({ status: "normal", projectID: result.projectID })
        return undefined
      }
      const offer: Offer = {
        status: "offer",
        requestID,
        sessionID,
        projectID: result.projectID,
        location,
        presets: result.presets,
        applied: result.enabled ? result.applied : [],
      }
      setState(offer)
      return offer
    } catch {
      fail("tui.permissions.loadFailed")
      return manual ? "failed" : undefined
    }
  }

  const run = async (decision: Decision, presetID: PresetID | undefined, offer: Offer) => {
    setState({ ...offer, status: "submitting", action: decision })
    try {
      const rpc = context.client.rpc(KiloPermissionsRpc.Definition)
      if (decision === "apply") {
        if (!presetID) return
        await rpc.apply({ presetID }, { location: offer.location })
      } else if (decision === "clear") {
        await rpc.clear({}, { location: offer.location })
      } else {
        await rpc.skip({}, { location: offer.location })
      }
    } catch {
      await syncAfterFailure(offer)
      fail("tui.permissions.applyFailed", offer.projectID)
      return
    }
    try {
      await sync(offer.sessionID)
    } catch {
      fail("tui.permissions.saveFailed", offer.projectID)
      return
    }
    if (decision !== "skip") await applied.refresh(offer.location)
    setState({ status: "normal", projectID: offer.projectID })
  }

  const api: Controller = {
    state,
    ensure(request) {
      const current = state()
      if (current.status === "submitting") {
        if (current.requestID !== request.id)
          setState({ ...current, requestID: request.id, sessionID: request.sessionID })
        return
      }
      if (current.status === "offer") {
        if (current.requestID !== request.id)
          setState({ ...current, requestID: request.id, sessionID: request.sessionID })
        return
      }
      if (current.status === "normal") return
      if (current.status === "checking") {
        if (current.requestID !== request.id)
          setState({ ...current, requestID: request.id, sessionID: request.sessionID })
        return
      }
      setState({ status: "checking", requestID: request.id, sessionID: request.sessionID })
      operation = resolveSessionLocation(context, request.sessionID)
        .then((location) => {
          if (!location) {
            fail("tui.permissions.loadFailed")
            return
          }
          return load(location, request.id, request.sessionID, false)
        })
        .catch(() => fail("tui.permissions.loadFailed"))
        .then(() => undefined)
        .finally(() => {
          operation = undefined
        })
    },
    async manual(location, sessionID) {
      const current = state()
      if (current.status === "submitting") return undefined
      if (current.status === "offer") return "active"
      const waiting = operation
      if (waiting) await waiting
      const after = state()
      if (after.status === "submitting") return undefined
      if (after.status === "offer") return waiting ? "active" : after
      let loaded: LoadResult
      operation = load(location, undefined, sessionID, true)
        .then((result) => {
          loaded = result
        })
        .finally(() => {
          operation = undefined
        })
      await operation
      const result = state()
      return loaded ?? (result.status === "offer" ? result : undefined)
    },
    decide(decision, presetID) {
      const current = state()
      if (current.status !== "offer" || (decision === "apply" && !presetID) || operation) return
      operation = run(decision, presetID, current).finally(() => {
        operation = undefined
      })
    },
  }

  const syncAfterFailure = async (offer: Offer) => {
    try {
      await sync(offer.sessionID)
    } catch {
      // The normal prompt remains authoritative when a resync fails.
    }
  }

  return api
}

async function resolveSessionLocation(context: Plugin.Context, sessionID: string): Promise<LocationRef | undefined> {
  const current = context.data.session.get(sessionID)
  if (current) return current.location
  await context.data.session.sync(sessionID).catch(() => undefined)
  return context.data.session.get(sessionID)?.location
}

async function openManual(context: Plugin.Context, getController: (directory: string) => Controller) {
  const route = context.ui.router.current()
  const location =
    route.type === "session"
      ? await resolveSessionLocation(context, route.sessionID)
      : (context.location ?? context.data.location.default())
  if (!location) {
    await context.ui.dialog.alert({ title: t("tui.permissions.title"), message: t("tui.permissions.loadFailed") })
    return
  }
  const selectedController = getController(location.directory)
  const result = await selectedController.manual(location, route.type === "session" ? route.sessionID : undefined)
  if (typeof result !== "object") {
    if (result === "active") return
    const message =
      result === "disabled"
        ? t("tui.permissions.disabled")
        : result === "failed"
          ? t("tui.permissions.loadFailed")
          : t("tui.permissions.noMatches")
    await context.ui.dialog.alert({ title: t("tui.permissions.title"), message })
    return
  }
  const applied = new Set(result.applied.map((preset) => preset.id))
  const choice = await context.ui.dialog.select<PresetID | "skip" | "clear">({
    title: t("tui.permissions.title"),
    options: [
      ...result.presets.map((preset) => ({
        title: `${t("tui.permissions.apply")} ${presetLabel(preset.id)}`,
        value: preset.id,
        description: presetDescription(preset.id),
        footer: applied.has(preset.id) ? t("tui.permissions.applied") : undefined,
      })),
      ...(applied.size > 0
        ? [
            {
              title: t("tui.permissions.none"),
              value: "clear" as const,
              description: t("tui.permissions.noneDescription"),
            },
          ]
        : []),
      { title: t("tui.permissions.skip"), value: "skip" },
    ],
    current: result.presets.find((preset) => applied.has(preset.id))?.id ?? result.presets[0]?.id,
  })
  // Dismissing the chooser changes nothing.
  if (choice === undefined) return
  if (choice === "skip" || choice === "clear") {
    selectedController.decide(choice)
    return
  }
  selectedController.decide("apply", choice)
}

function PermissionGate(props: {
  readonly controller: Controller
  readonly request: PermissionRequest
  readonly directory: string | undefined
  readonly registerNavigation: (value: Navigation | undefined) => void
}) {
  // Start the project check when a request is shown; `on` keeps the controller's own state out of the tracking.
  createEffect(
    on(
      () => props.request.id,
      () => props.controller.ensure(props.request),
    ),
  )
  const state = props.controller.state
  return (
    <Switch>
      <Match when={state().status === "checking"}>
        <PermissionStatus message={t("tui.permissions.checking")} />
      </Match>
      <Match when={state().status === "submitting"}>
        <PermissionStatus message={t("tui.permissions.applying")} />
      </Match>
      <Match when={state().status === "offer"}>
        <Show when={state().status === "offer"}>
          <PermissionOffer
            controller={props.controller}
            request={props.request}
            offer={state() as Offer}
            registerNavigation={props.registerNavigation}
          />
        </Show>
      </Match>
      <Match when={true}>
        <PermissionPrompt request={props.request} directory={props.directory} />
      </Match>
    </Switch>
  )
}

function PermissionStatus(props: { readonly message: string }) {
  const theme = useTheme()
  return (
    <box id="session.permission.status" paddingLeft={2} paddingTop={1} paddingBottom={1}>
      <text fg={theme.text.muted}>{props.message}</text>
    </box>
  )
}

function PermissionOffer(props: {
  readonly controller: Controller
  readonly request: PermissionRequest
  readonly offer: Offer
  readonly registerNavigation: (value: Navigation | undefined) => void
}) {
  const theme = useTheme()
  const [selected, setSelected] = createSignal(0)
  let preview: ScrollBoxRenderable | undefined
  const preset = createMemo(() => props.offer.presets[selected()] ?? props.offer.presets[0])
  const move = (delta: number) => {
    const next = Math.max(0, Math.min(props.offer.presets.length - 1, selected() + delta))
    setSelected(next)
    preview?.scrollTo(0)
  }

  const navigation: Navigation = {
    move,
    scroll: (pages) => {
      if (!preview) return
      preview.scrollBy(pages * Math.max(1, preview.viewport.height))
    },
  }
  props.registerNavigation(navigation)
  onCleanup(() => props.registerNavigation(undefined))

  return (
    <SessionQuestion
      id="session.permission.setup"
      instance={props.request.id}
      title={t("tui.permissions.title")}
      choicesLabel={t("tui.permissions.choose")}
      options={{ apply: t("tui.permissions.apply"), skip: t("tui.permissions.skip") }}
      escapeKey="skip"
      fullscreen
      onSelect={(choice) => {
        if (choice === "apply") props.controller.decide("apply", preset()?.id)
        else props.controller.decide("skip")
      }}
      body={
        <scrollbox
          ref={(value: ScrollBoxRenderable) => {
            preview = value
          }}
          flexGrow={1}
          minHeight={0}
          contentOptions={{ minHeight: 0 }}
          scrollbarOptions={{ visible: false }}
        >
          <box flexDirection="column" gap={1} paddingLeft={1} paddingRight={1} paddingBottom={1}>
            <text fg={theme.text.muted}>{t("tui.permissions.choose")}</text>
            <For each={props.offer.presets}>
              {(option, index) => {
                const active = createMemo(() => index() === selected())
                return (
                  <text fg={active() ? theme.text.formfield.focused : theme.text.muted}>
                    <span style={{ fg: active() ? theme.text.formfield.selected : theme.text.formfield.base }}>
                      {active() ? "● " : "○ "}
                    </span>
                    {presetLabel(option.id)}
                  </text>
                )
              }}
            </For>
            <Show when={preset()}>
              {(current) => (
                <>
                  <text fg={theme.text.muted}>{presetDescription(current().id)}</text>
                  <text fg={theme.text.muted}>{t("tui.permissions.rules")}</text>
                  <For each={current().resources}>{(resource) => <text fg={theme.text.base}>{resource}</text>}</For>
                  <text fg={theme.text.feedback.warning.base}>{t("tui.permissions.trust")}</text>
                  <Show when={current().id.endsWith("-install")}>
                    <text fg={theme.text.feedback.warning.base}>{t("tui.permissions.installWarning")}</text>
                  </Show>
                </>
              )}
            </Show>
          </box>
        </scrollbox>
      }
    />
  )
}

function SidebarPermissions(props: {
  readonly context: Plugin.Context
  readonly applied: Applied
  readonly sessionID: string
  readonly open: () => void
}) {
  const theme = props.context.theme
  const [projectID, setProjectID] = createSignal<string>()
  const location = createMemo(() => props.context.data.session.get(props.sessionID)?.location)
  createEffect(
    on(location, (current) => {
      if (current) void props.applied.refresh(current).then(setProjectID)
    }),
  )
  const sets = createMemo(() => {
    const id = projectID()
    return id ? props.applied.get(id) : []
  })
  return (
    <Show when={sets().length > 0}>
      <box onMouseUp={props.open}>
        <text fg={theme.text.base}>
          <b>{t("tui.permissions.sidebar")}</b>
          <span style={{ fg: theme.text.muted }}> /permissions</span>
        </text>
        <For each={sets()}>
          {(set) => (
            <box flexDirection="row" gap={1} minWidth={0}>
              <text flexShrink={0} fg={theme.text.feedback.success.base}>
                •
              </text>
              <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                {presetLabel(set.id)}
              </text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}
