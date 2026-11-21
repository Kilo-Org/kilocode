import { dict } from "@kilocode/kilo-i18n/en"
import type { LocationRef, PermissionRequest } from "@opencode/client"
import { KiloPermissionsRpc } from "@opencode/schema/kilocode/permissions"
import type { Preset, PresetID } from "@opencode/schema/kilocode/permissions"
import type { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout } from "../ui/dialog"
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

type Decision = "update" | "skip" | "clear"

// The sets to add and remove so the applied sets match the checked ones.
type Change = { readonly apply: readonly Preset[]; readonly remove: readonly PresetID[] }

type Offer = Extract<ControllerState, { status: "offer" }>

type LoadResult = Offer | "active" | "disabled" | "unidentified" | "no_matches" | "failed" | undefined

type Controller = {
  readonly state: () => ControllerState
  readonly ensure: (request: PermissionRequest) => void
  readonly manual: (location: LocationRef, sessionID?: string) => Promise<LoadResult>
  readonly decide: (decision: Decision, change?: Change) => void
  readonly dismiss: () => void
}
// Sets applied to each project, keyed by project ID; the sidebar shows them while any are applied.
type Applied = {
  readonly get: (projectID: string) => readonly Preset[]
  readonly refresh: (location: LocationRef) => Promise<string | undefined>
  readonly dispose: () => void
}
type Navigation = {
  readonly move: (delta: number) => void
  readonly toggle: () => void
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
              review={(presets) => reviewPresets(context, presets)}
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
                id: "kilo.permissions.toggle",
                bind: "space",
                title: "Check or uncheck permission set",
                run: () => navigation()?.toggle(),
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
      if (result.unidentified) {
        setState({ status: "normal", projectID: result.projectID })
        return manual ? "unidentified" : undefined
      }
      // A set applied before the project stopped matching still applies, so the chooser stays open to remove it.
      if (result.presets.length === 0 && (!manual || result.applied.length === 0)) {
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

  const run = async (decision: Decision, change: Change | undefined, offer: Offer) => {
    setState({ ...offer, status: "submitting", action: decision })
    try {
      const rpc = context.client.rpc(KiloPermissionsRpc.Definition)
      if (decision === "update") {
        // Removals first: an apply settles the waiting requests the sets cover, so it runs with the final sets.
        for (const presetID of change?.remove ?? []) await rpc.remove({ presetID }, { location: offer.location })
        for (const preset of change?.apply ?? []) await rpc.apply({ presetID: preset.id }, { location: offer.location })
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
    decide(decision, change) {
      const current = state()
      if (current.status !== "offer" || operation) return
      if (decision === "update" && !change?.apply.length && !change?.remove.length) return
      operation = run(decision, change, current).finally(() => {
        operation = undefined
      })
    },
    // Closing the manual chooser without a choice leaves the offer state behind; without this reset the next
    // `/permissions` sees an active offer and does nothing.
    dismiss() {
      const current = state()
      if (current.status === "offer") setState({ status: "normal", projectID: current.projectID })
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
    await context.ui.dialog.alert({
      title: t("tui.permissions.title"),
      message: t(manualMessages[result ?? "no_matches"]),
    })
    return
  }
  // A set applied before the project stopped matching is listed too, so unchecking it can remove it.
  const options = [
    ...result.presets,
    ...result.applied.filter((set) => !result.presets.some((preset) => preset.id === set.id)),
  ]
  const checked = await choosePresets(context, options, result.applied)
  // Dismissing the chooser changes nothing.
  if (checked === undefined) {
    selectedController.dismiss()
    return
  }
  const change = planChange(options, result.applied, checked)
  if (change.apply.length === 0 && change.remove.length === 0) {
    selectedController.dismiss()
    return
  }
  // Unchecking every set is the old "(None)": it removes them and records that no set is wanted.
  if (checked.size === 0) {
    selectedController.decide("clear")
    return
  }
  // Newly checked sets have their shell patterns and warnings reviewed before anything changes.
  if (change.apply.length > 0 && !(await reviewPresets(context, change.apply))) {
    selectedController.dismiss()
    return
  }
  selectedController.decide("update", change)
}

function planChange(options: readonly Preset[], applied: readonly Preset[], checked: ReadonlySet<PresetID>): Change {
  return {
    apply: options.filter((preset) => checked.has(preset.id) && !applied.some((set) => set.id === preset.id)),
    remove: applied.filter((set) => !checked.has(set.id)).map((set) => set.id),
  }
}

function choosePresets(context: Plugin.Context, options: readonly Preset[], applied: readonly Preset[]) {
  return new Promise<ReadonlySet<PresetID> | undefined>((resolve) => {
    context.ui.dialog.show(
      () => (
        <PresetChooser
          options={options}
          applied={applied}
          onDone={(checked) => {
            resolve(checked)
            context.ui.dialog.clear()
          }}
        />
      ),
      () => resolve(undefined),
    )
    context.ui.dialog.set({ size: "large" })
  })
}

/** `/permissions`: every set as a checkbox, checked while applied. */
function PresetChooser(props: {
  readonly options: readonly Preset[]
  readonly applied: readonly Preset[]
  readonly onDone: (checked: ReadonlySet<PresetID> | undefined) => void
}) {
  const theme = useTheme()
  const [cursor, setCursor] = createSignal(0)
  const [checked, setChecked] = createSignal<ReadonlySet<PresetID>>(new Set(props.applied.map((set) => set.id)))
  const toggle = (id: PresetID) =>
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const move = (delta: number) => setCursor((index) => Math.max(0, Math.min(props.options.length - 1, index + delta)))
  const toggleCursor = () => {
    const preset = props.options[cursor()]
    if (preset) toggle(preset.id)
  }
  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "up,k", run: () => move(-1) },
      { bind: "down,j", run: () => move(1) },
      { bind: "space", run: toggleCursor },
      { bind: "return", run: () => props.onDone(checked()) },
      { bind: "escape", run: () => props.onDone(undefined) },
    ],
  }))
  return (
    <DialogLayout
      header={<DialogHeader title={t("tui.permissions.title")} />}
      footer={{
        actions: {
          primary: [
            { title: t("tui.permissions.cancel"), key: "esc", onTrigger: () => props.onDone(undefined) },
            { title: t("tui.permissions.toggle"), key: "space", onTrigger: toggleCursor },
            { title: t("tui.permissions.apply"), key: "enter", onTrigger: () => props.onDone(checked()) },
          ],
        },
      }}
    >
      <box flexDirection="column" gap={1}>
        <For each={props.options}>
          {(preset, index) => (
            <box
              flexDirection="column"
              onMouseUp={() => {
                setCursor(index())
                toggle(preset.id)
              }}
            >
              <box flexDirection="row" gap={1}>
                <PresetCheckbox
                  id={preset.id}
                  active={index() === cursor()}
                  checked={checked().has(preset.id)}
                />
                <Show when={props.applied.some((set) => set.id === preset.id)}>
                  <text fg={theme.text.muted}>{t("tui.permissions.applied")}</text>
                </Show>
              </box>
              <box paddingLeft={6}>
                <text fg={theme.text.muted}>{presetDescription(preset.id)}</text>
              </box>
            </box>
          )}
        </For>
      </box>
    </DialogLayout>
  )
}

/** One set's row: the cursor, its checkbox and its label. */
function PresetCheckbox(props: { readonly id: PresetID; readonly active: boolean; readonly checked: boolean }) {
  const theme = useTheme()
  return (
    <text fg={props.active ? theme.text.formfield.focused : theme.text.formfield.base}>
      <span
        style={{
          fg: props.active
            ? theme.text.formfield.focused
            : props.checked
              ? theme.text.formfield.selected
              : theme.text.muted,
        }}
      >
        {`${props.active ? "›" : " "} [${props.checked ? "✓" : " "}] `}
      </span>
      {presetLabel(props.id)}
    </text>
  )
}

const manualMessages = {
  disabled: "tui.permissions.disabled",
  unidentified: "tui.permissions.unidentified",
  failed: "tui.permissions.loadFailed",
  no_matches: "tui.permissions.noMatches",
} as const satisfies Record<Exclude<LoadResult, Offer | "active" | undefined>, CopyKey>

function reviewPresets(context: Plugin.Context, presets: readonly Preset[]) {
  return new Promise<boolean>((resolve) => {
    context.ui.dialog.show(
      () => (
        <PresetReview
          presets={presets}
          onChoose={(confirmed) => {
            resolve(confirmed)
            context.ui.dialog.clear()
          }}
        />
      ),
      () => resolve(false),
    )
    context.ui.dialog.set({ size: "large" })
  })
}

/** Each set's description and shell patterns, then the warnings, scrollable on short terminals. */
function PresetReview(props: { readonly presets: readonly Preset[]; readonly onChoose: (confirmed: boolean) => void }) {
  const dimensions = useTerminalDimensions()
  let preview: ScrollBoxRenderable | undefined
  const scroll = (pages: number) => preview?.scrollBy(pages * Math.max(1, preview.viewport.height))
  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", run: () => props.onChoose(true) },
      { bind: "escape", run: () => props.onChoose(false) },
      { bind: "pageup", run: () => scroll(-1) },
      { bind: "pagedown", run: () => scroll(1) },
    ],
  }))
  return (
    <DialogLayout
      header={
        <DialogHeader
          title={`${t("tui.permissions.apply")} ${props.presets.map((preset) => presetLabel(preset.id)).join(", ")}`}
        />
      }
      footer={{
        actions: {
          primary: [
            { title: t("tui.permissions.cancel"), key: "esc", onTrigger: () => props.onChoose(false) },
            { title: t("tui.permissions.apply"), key: "enter", onTrigger: () => props.onChoose(true) },
          ],
        },
      }}
    >
      <scrollbox
        id="permission-set-review"
        ref={(value: ScrollBoxRenderable) => {
          preview = value
        }}
        maxHeight={Math.max(1, Math.floor(dimensions().height * 0.75) - 8)}
        contentOptions={{ minHeight: 0 }}
      >
        <box flexDirection="column" gap={1}>
          <PresetDetails presets={props.presets} />
        </box>
      </scrollbox>
    </DialogLayout>
  )
}

/**
 * What applying sets allows: the same content in the automatic offer and in the review. Several sets are each
 * headed by their label.
 */
function PresetDetails(props: { readonly presets: readonly Preset[] }) {
  const theme = useTheme()
  return (
    <>
      <For each={props.presets}>
        {(preset) => (
          <>
            <Show when={props.presets.length > 1}>
              <text fg={theme.text.base}>
                <b>{presetLabel(preset.id)}</b>
              </text>
            </Show>
            <text fg={theme.text.muted}>{presetDescription(preset.id)}</text>
            <text fg={theme.text.muted}>{t("tui.permissions.rules")}</text>
            <box>
              <For each={preset.resources}>{(resource) => <text fg={theme.text.base}>{resource}</text>}</For>
            </box>
          </>
        )}
      </For>
      <text fg={theme.text.muted}>{t("tui.permissions.helpers")}</text>
      <text fg={theme.text.feedback.warning.base}>{t("tui.permissions.trust")}</text>
      <Show when={props.presets.some((preset) => preset.id.endsWith("-install"))}>
        <text fg={theme.text.feedback.warning.base}>{t("tui.permissions.installWarning")}</text>
      </Show>
    </>
  )
}

function PermissionGate(props: {
  readonly controller: Controller
  readonly request: PermissionRequest
  readonly directory: string | undefined
  readonly registerNavigation: (value: Navigation | undefined) => void
  readonly review: (presets: readonly Preset[]) => Promise<boolean>
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
            review={props.review}
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
  readonly review: (presets: readonly Preset[]) => Promise<boolean>
}) {
  const theme = useTheme()
  const [selected, setSelected] = createSignal(0)
  // Sets already applied start checked; otherwise the first (the project's default) does.
  const [checked, setChecked] = createSignal<ReadonlySet<PresetID>>(
    new Set(
      props.offer.applied.length > 0
        ? props.offer.applied.map((set) => set.id)
        : props.offer.presets.slice(0, 1).map((preset) => preset.id),
    ),
  )
  let preview: ScrollBoxRenderable | undefined
  const preset = createMemo(() => props.offer.presets[selected()] ?? props.offer.presets[0])
  const move = (delta: number) => {
    const next = Math.max(0, Math.min(props.offer.presets.length - 1, selected() + delta))
    setSelected(next)
    preview?.scrollTo(0)
  }

  const navigation: Navigation = {
    move,
    toggle: () => {
      const current = preset()
      if (!current) return
      setChecked((value) => {
        const next = new Set(value)
        if (next.has(current.id)) next.delete(current.id)
        else next.add(current.id)
        return next
      })
    },
    scroll: (pages) => {
      if (!preview) return
      preview.scrollBy(pages * Math.max(1, preview.viewport.height))
    },
  }
  let disposed = false
  props.registerNavigation(navigation)
  onCleanup(() => {
    disposed = true
    props.registerNavigation(undefined)
  })

  // Same confirmation as `/permissions`. The offer's navigation keys are global, so they are released while the
  // review is open; cancelling returns to the offer.
  // Apply with nothing to change, including nothing checked, is a skip.
  const apply = async () => {
    const change = planChange(props.offer.presets, props.offer.applied, checked())
    if (checked().size === 0 && change.remove.length > 0) {
      props.controller.decide("clear")
      return
    }
    if (change.apply.length === 0 && change.remove.length === 0) {
      props.controller.decide("skip")
      return
    }
    if (change.apply.length === 0) {
      props.controller.decide("update", change)
      return
    }
    props.registerNavigation(undefined)
    const confirmed = await props.review(change.apply)
    if (confirmed) {
      props.controller.decide("update", change)
      return
    }
    if (!disposed) props.registerNavigation(navigation)
  }

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
        if (choice === "apply") void apply()
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
            <box>
              <For each={props.offer.presets}>
                {(option, index) => (
                  <box
                    onMouseUp={() => {
                      setSelected(index())
                      navigation.toggle()
                    }}
                  >
                    <PresetCheckbox
                      id={option.id}
                      active={index() === selected()}
                      checked={checked().has(option.id)}
                    />
                  </box>
                )}
              </For>
            </box>
            <Show when={preset()}>{(current) => <PresetDetails presets={[current()]} />}</Show>
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
