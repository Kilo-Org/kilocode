import { createClient, type RpcCallOptions } from "@kilocode/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import {
  SettingsRpc,
  type SettingsChange,
  type SettingsFieldKey,
  type SettingsFieldState,
  type SettingsScope,
  type SettingsScopeState,
  type SettingsSnapshot,
  type SettingsValue,
} from "../settings-rpc"

export type SettingsUiClient = Pick<ReturnType<typeof createClient>, "rpc">

export type SettingsUiOptions = {
  readonly client?: SettingsUiClient
  readonly signal?: AbortSignal
}

type Edit = { readonly reset: true } | { readonly value: SettingsValue }

export function settingsUiRequestOptions(
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

/**
 * Add the Kilo configuration command. It is distinct from the native
 * `/settings` presentation dialog and never edits TUI presentation state.
 */
export function installSettingsUi(ctx: Plugin.Context, options: SettingsUiOptions = {}) {
  const rpc = options.client?.rpc(SettingsRpc.Definition)

  ctx.keymap.layer(() => ({
    mode: "global",
    priority: 2,
    commands: [
      {
        id: "kilo.settings",
        title: "Kilo settings",
        description: "Manage Kilo profile and project configuration",
        group: "Kilo",
        bind: false,
        palette: true,
        suggested: true,
        slash: { name: "kilo-settings", aliases: ["kilo-config"] },
        run: async () => {
          if (options.signal?.aborted) return
          if (!rpc) {
            await ctx.ui.dialog.alert({
              title: "Kilo settings",
              message: "Restart this preview to enable Kilo settings controls.",
            })
            return
          }
          const request = settingsUiRequestOptions(ctx, options.signal)
          try {
            const snapshot = await rpc.read({}, request)
            const scope = await ctx.ui.dialog.select<SettingsScope>({
              title: "Kilo settings",
              placeholder: "Select a configuration scope",
              // A disabled option is filtered out of DialogSelect entirely, so an
              // unwritable scope stays selectable and explains itself instead.
              options: snapshot.scopes.map((item) => ({
                title: scopeTitle(item),
                value: item.scope,
                description: scopeDescription(item),
              })),
            })
            if (scope === undefined) return
            const selected = state(snapshot, scope)
            if (!selected.writable) {
              await ctx.ui.dialog.alert({
                title: `Kilo settings · ${scopeTitle(selected)}`,
                message: selected.reason ?? `The ${scope} configuration target is not writable.`,
              })
              return
            }
            const key = await ctx.ui.dialog.select<SettingsFieldKey>({
              title: `Kilo settings · ${scopeTitle(selected)}`,
              placeholder: "Select a setting",
              options: snapshot.fields.map((field) => ({
                title: field.title,
                value: field.key,
                description: fieldDescription(field, snapshot),
              })),
            })
            if (key === undefined) return
            const field = snapshot.fields.find((item) => item.key === key)
            if (!field) return
            const edit = await editValue(ctx, field, scope)
            if (!edit) return
            const reset = "reset" in edit
            const change = reset
              ? await rpc.reset({ scope, key, expected: selected.expected }, request)
              : await rpc.set({ scope, key, value: edit.value, expected: selected.expected }, request)
            ctx.ui.toast.show({
              title: "Kilo settings",
              message: changeMessage(change, field, reset),
              variant: change.changed ? "success" : "info",
            })
          } catch (error) {
            if (options.signal?.aborted) return
            await ctx.ui.dialog.alert({ title: "Kilo settings failed", message: message(error) })
          }
        },
      },
    ],
  }))
}

async function editValue(
  ctx: Plugin.Context,
  field: SettingsFieldState,
  scope: SettingsScope,
): Promise<Edit | undefined> {
  const current = field.values[scope]
  if (field.kind === "boolean" || field.kind === "choice") {
    const choices =
      field.kind === "boolean"
        ? [
            { title: "Enabled", value: { value: true } as Edit },
            { title: "Disabled", value: { value: false } as Edit },
          ]
        : (field.options ?? []).map((option) => ({ title: option.title, value: { value: option.value } as Edit }))
    return ctx.ui.dialog.select<Edit>({
      title: field.title,
      placeholder: `Current in ${scope}: ${format(current)}`,
      options: [
        ...choices,
        { title: "Unset", value: { reset: true } as Edit, description: `Remove this setting from the ${scope} scope` },
      ],
    })
  }
  const entered = await ctx.ui.dialog.prompt({
    title: field.title,
    description: `${field.description}. Submit an empty value to unset it in the ${scope} scope.`,
    ...(typeof current === "string" || typeof current === "number" ? { value: String(current) } : {}),
  })
  if (entered === undefined) return undefined
  const value = entered.trim()
  if (!value) return { reset: true }
  if (field.kind !== "integer") return { value }
  const parsed = Number(value)
  const minimum = field.minimum ?? 1
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    ctx.ui.toast.show({ title: field.title, message: `Enter a whole number of at least ${minimum}`, variant: "error" })
    return undefined
  }
  return { value: parsed }
}

function state(snapshot: SettingsSnapshot, scope: SettingsScope) {
  const found = snapshot.scopes.find((item) => item.scope === scope)
  if (found) return found
  return { scope, path: "", exists: false, writable: false } satisfies SettingsScopeState
}

function scopeTitle(scope: SettingsScopeState) {
  return scope.scope === "profile" ? "Profile" : "Project"
}

function scopeDescription(scope: SettingsScopeState) {
  if (!scope.writable) return scope.reason ?? "Not writable"
  return `${scope.exists ? "Edits" : "Creates"} ${scope.path}`
}

function fieldDescription(field: SettingsFieldState, snapshot: SettingsSnapshot) {
  const project = snapshot.scopes.find((item) => item.scope === "project")
  return [
    `profile: ${format(field.values.profile)}`,
    ...(project?.writable ? [`project: ${format(field.values.project)}`] : []),
    `applies: ${field.source}`,
    ...(field.invalid ? [field.invalid] : []),
  ].join(" · ")
}

function changeMessage(change: SettingsChange, field: SettingsFieldState, reset: boolean) {
  if (!change.changed)
    return `${field.title} was already ${reset ? "unset" : "set that way"} in the ${change.scope} scope.`
  const applied = change.snapshot.restartRequired ? " Restart Kilo to load it." : ""
  return `${field.title} ${reset ? "removed from" : "updated in"} the ${change.scope} scope.${applied}`
}

function format(value: unknown) {
  if (value === undefined) return "unset"
  if (typeof value === "string") return value
  if (typeof value === "boolean" || typeof value === "number") return String(value)
  return JSON.stringify(value)
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return "Unable to complete the Kilo settings operation"
}
