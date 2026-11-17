// `/browser`: the browser tools' state — the backend, whether it can run, and the origin grants the CLI enforces —
// and the switch between the bundled Playwright browser, the Kilo browser extension and off. The choices are the same
// `browser` keys the VS Code settings panel writes, through the same `kilocode.settings` RPC.
import { dict } from "@kilocode/kilo-i18n/en"
import { KiloSettingsRpc } from "@opencode/schema/kilocode/settings"
import type { Plugin } from "@opencode/plugin/tui"

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

/** The state as the command shows it. Defaults follow the config schema: playwright, full, not sensitive. */
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
    observation: OBSERVATIONS.includes(input.observation as Observation) ? (input.observation as Observation) : "full",
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

    const choose = async (): Promise<string | undefined> =>
      context.ui.dialog.select<string>({
        title: copy("browser.command.title"),
        placeholder: describeState(state).split("\n")[0],
        options: [
          ...BACKENDS.map((backend) => ({
            title: `${copy("browser.command.backend")}: ${copy(`browser.backend.${backend}` as keyof typeof dict)}`,
            value: `backend:${backend}`,
            current: state.backend === backend,
            description:
              backend === "extension"
                ? copy("browser.state.extensionHint")
                : backend === "off"
                  ? copy("browser.backend.offHint")
                  : copy("browser.state.readyHint"),
          })),
          ...OBSERVATIONS.map((observation) => ({
            title: `${copy("browser.command.observation")}: ${copy(`browser.observation.${observation}` as keyof typeof dict)}`,
            value: `observation:${observation}`,
            current: state.observation === observation,
          })),
          {
            title: `${copy("browser.command.sensitive")}: ${state.allowSensitive ? copy("browser.sensitive.allowed") : copy("browser.sensitive.asks")}`,
            value: "sensitive:toggle",
          },
          {
            title: copy("browser.command.grants"),
            value: "grants:show",
            description: state.allowAll ? copy("browser.grants.all") : `${state.grants.length}`,
          },
        ],
      })

    const action = await choose()
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
      if (action === "sensitive:toggle") {
        await write(context, { allow_sensitive: !state.allowSensitive })
        context.ui.toast.show({
          variant: "info",
          message: !state.allowSensitive ? copy("browser.sensitive.allowed") : copy("browser.sensitive.asks"),
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
