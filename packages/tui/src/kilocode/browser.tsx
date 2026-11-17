// `/browser`: the browser tools' state — the backend, whether it can run, and the origin grants the CLI enforces —
// and the switch between the bundled Playwright browser, the Kilo browser extension and off. The choices are the same
// `browser` keys the VS Code settings panel writes, through the same `kilocode.settings` RPC.
import { dict } from "@kilocode/kilo-i18n/en"
import { KiloSettingsRpc } from "@opencode/schema/kilocode/settings"
import type { Plugin } from "@opencode/plugin/tui"
import { For } from "solid-js"
import { useTheme } from "../context/theme"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"

type Backend = "playwright" | "extension" | "off"
type Observation = "full" | "diff" | "none"
type Rule = { action: string; resource: string; effect: "allow" | "ask" | "deny" }

export type State = {
  backend: Backend
  observation: Observation
  allowSensitive: boolean
  grants: Rule[]
  allowAll: boolean
}

const copy = (key: keyof typeof dict) => dict[key] ?? key
const BACKENDS: readonly Backend[] = ["playwright", "extension", "off"]
const OBSERVATIONS: readonly Observation[] = ["full", "diff", "none"]

/** The document the writer targets, read through the settings RPC. */
async function document(context: Plugin.Context) {
  const client = context.client
  const settings = client.rpc(KiloSettingsRpc.Definition)
  const location = { location: { directory: context.location?.directory ?? process.cwd() } }
  const read = await settings.read({ scope: "global" }, location)
  return { settings, location, target: read.target, document: read.document }
}

function rules(documentValue: unknown): Rule[] {
  if (typeof documentValue !== "object" || documentValue === null) return []
  const value = (documentValue as { permissions?: unknown }).permissions
  if (!Array.isArray(value)) return []
  return value.flatMap((rule): Rule[] => {
    if (typeof rule !== "object" || rule === null) return []
    const { action, resource, effect } = rule as Partial<Rule>
    if (typeof action !== "string" || typeof resource !== "string") return []
    if (effect !== "allow" && effect !== "ask" && effect !== "deny") return []
    return [{ action, resource, effect }]
  })
}

/** The state as the command shows it. Defaults follow the browser plugin's: playwright, diff, not sensitive. */
export function readState(documentValue: unknown): State {
  const input =
    typeof documentValue === "object" &&
    documentValue !== null &&
    typeof (documentValue as { browser?: unknown }).browser === "object"
      ? ((documentValue as { browser?: Record<string, unknown> }).browser ?? {})
      : {}
  const all = rules(documentValue)
  const browser = all.filter((rule) => rule.action === "browser")
  return {
    backend: BACKENDS.includes(input.backend as Backend) ? (input.backend as Backend) : "playwright",
    observation: OBSERVATIONS.includes(input.observation as Observation) ? (input.observation as Observation) : "diff",
    allowSensitive: input.allow_sensitive === true,
    grants: browser.filter((rule) => rule.resource !== "*"),
    allowAll: browser.some((rule) => rule.resource === "*" && rule.effect === "allow"),
  }
}

/** The line one grant reads as, and the CLI's own spelling of it. */
export function grantLine(rule: Rule) {
  if (rule.action !== "browser") return `${rule.action} → ${rule.effect}`
  if (rule.resource === "*") return copy("browser.grants.all")
  const index = rule.resource.indexOf(":")
  if (index < 0) return `${rule.resource} → ${rule.effect}`
  return `${rule.resource.slice(0, index)} on ${rule.resource.slice(index + 1)} → ${rule.effect}`
}

/** The backend line: the bundled browser starts on the first call, the extension is not wired yet (part C). */
export function describeState(state: State) {
  const backend =
    state.backend === "playwright"
      ? `${copy("browser.backend.playwright")} — ${copy("browser.state.ready")}`
      : state.backend === "extension"
        ? `${copy("browser.backend.extension")} — ${copy("browser.state.unavailable")}`
        : copy("browser.backend.off")
  return [
    `${copy("browser.command.backend")}: ${backend}`,
    `${copy("browser.command.observation")}: ${state.observation}`,
    `${copy("browser.command.sensitive")}: ${state.allowSensitive ? copy("browser.sensitive.allowed") : copy("browser.sensitive.asks")}`,
    `${copy("browser.command.grants")}: ${
      state.allowAll
        ? copy("browser.grants.all")
        : state.grants.length === 0
          ? copy("browser.grants.none")
          : state.grants.length
    }`,
  ].join("\n")
}

async function write(context: Plugin.Context, browser: Record<string, unknown>) {
  const { settings, location, target, document: current } = await document(context)
  const existing =
    typeof current === "object" && current !== null && typeof (current as { browser?: unknown }).browser === "object"
      ? ((current as { browser?: Record<string, unknown> }).browser ?? {})
      : {}
  await settings.write(
    {
      scope: "global",
      // The RPC's values are JSON; this block carries strings, booleans and rule objects only.
      set: { browser: { ...existing, ...browser } } as never,
      ...(target.revision ? { expected: { path: target.path, revision: target.revision } } : {}),
    },
    location,
  )
}

/**
 * The rows of the `/browser` dialog, grouped by setting. Each backend's hint is a detail line of its own, so it stays
 * readable at any dialog width instead of being clipped after the title.
 */
export function browserOptions(state: State): DialogSelectOption<string>[] {
  return [
    ...BACKENDS.map((backend) => ({
      category: copy("browser.command.backend"),
      title: copy(`browser.backend.${backend}` as keyof typeof dict),
      value: `backend:${backend}`,
      details: [
        backend === "extension"
          ? copy("browser.state.extensionHint")
          : backend === "off"
            ? copy("browser.backend.offHint")
            : copy("browser.state.readyHint"),
      ],
    })),
    ...OBSERVATIONS.map((observation) => ({
      category: copy("browser.command.observation"),
      title: copy(`browser.observation.${observation}` as keyof typeof dict),
      value: `observation:${observation}`,
    })),
    ...[false, true].map((allow) => ({
      category: copy("browser.command.sensitive"),
      title: allow ? copy("browser.sensitive.allowed") : copy("browser.sensitive.asks"),
      value: `sensitive:${allow}`,
    })),
    {
      category: copy("browser.command.grants"),
      title: copy("browser.grants.title"),
      value: "grants:show",
      description: state.allowAll
        ? copy("browser.grants.all")
        : state.grants.length === 0
          ? copy("browser.grants.none")
          : `${state.grants.length}`,
    },
  ]
}

/** The current backend, observation and sensitive-step choice, one line each under the list. */
function StateLines(props: { state: State }) {
  const theme = useTheme().surface("dialog")
  return (
    <box flexDirection="column">
      <For each={describeState(props.state).split("\n").slice(0, 3)}>
        {(line) => <text fg={theme.text.muted}>{line}</text>}
      </For>
    </box>
  )
}

export function browserLayer(context: Plugin.Context) {
  const open = async () => {
    let state: State
    try {
      state = readState((await document(context)).document)
    } catch (error) {
      context.ui.toast.show({
        variant: "error",
        title: copy("browser.command.title"),
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }

    const picked = Promise.withResolvers<string | undefined>()
    context.ui.dialog.show(
      () => (
        <DialogSelect<string>
          title={copy("browser.command.title")}
          options={browserOptions(state)}
          current={`backend:${state.backend}`}
          footer={<StateLines state={state} />}
          onSelect={(option) => {
            picked.resolve(option.value)
            context.ui.dialog.clear()
          }}
        />
      ),
      () => picked.resolve(undefined),
    )
    // The widest dialog; it is capped at the terminal width, so the rows use whatever room the pane has.
    context.ui.dialog.set({ size: "xlarge" })
    const action = await picked.promise
    if (!action) return
    try {
      if (action.startsWith("backend:")) {
        const backend = action.slice("backend:".length) as Backend
        await write(context, { backend })
        context.ui.toast.show({
          variant: "info",
          message: `${copy("browser.command.backend")}: ${copy(`browser.backend.${backend}` as keyof typeof dict)}`,
        })
        return
      }
      if (action.startsWith("observation:")) {
        const observation = action.slice("observation:".length) as Observation
        await write(context, { observation })
        context.ui.toast.show({ variant: "info", message: `${copy("browser.command.observation")}: ${observation}` })
        return
      }
      if (action.startsWith("sensitive:")) {
        const allow = action === "sensitive:true"
        await write(context, { allow_sensitive: allow })
        context.ui.toast.show({
          variant: "info",
          message: allow ? copy("browser.sensitive.allowed") : copy("browser.sensitive.asks"),
        })
        return
      }
      const grants = state.allowAll
        ? [copy("browser.grants.all")]
        : state.grants.length === 0
          ? [copy("browser.grants.none")]
          : state.grants.map(grantLine)
      await context.ui.dialog.alert({
        title: copy("browser.grants.title"),
        message: [...grants, "", copy("browser.grants.editHint")].join("\n"),
      })
    } catch (error) {
      context.ui.toast.show({
        variant: "error",
        title: copy("browser.command.title"),
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "kilo.browser",
        title: copy("browser.command.title"),
        description: copy("browser.command.description"),
        group: "System",
        palette: true,
        slash: { name: "browser" },
        run: open,
      },
    ],
  }))
}
