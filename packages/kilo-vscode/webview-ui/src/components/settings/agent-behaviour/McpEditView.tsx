// The MCP server edit view. It edits one server's `mcp.servers.<name>` entry and writes the whole object back in
// the scope that defines it. The local fields map to a `type: "local"` server (`command` holds the executable and
// its arguments) and the remote fields to a `type: "remote"` server (`url` and, optionally, `oauth`).
import { Component, Show, createMemo, createSignal, For } from "solid-js"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Select } from "@kilocode/kilo-ui/select"
import { useLanguage } from "../../../context/language"
import { useSettingsConfig } from "../../../v2/settings-config"
import { oauthFields, oauthMode, oauthPatch, validateOauth, type OauthMode, type OauthValue } from "./mcp-oauth-config"

interface Props {
  name: string
  onBack: () => void
  onRemove: (name: string) => void
}

const McpEditView: Component<Props> = (props) => {
  const language = useLanguage()
  const config = useSettingsConfig()

  const path = () => ["mcp", "servers", props.name]
  const scope = () => config.source(path()) ?? "project"
  const server = () => ({ ...((config.value(path()) ?? {}) as Record<string, unknown>) })

  const initialOauth = oauthFields(server().oauth as OauthValue | false | null | undefined)

  const [envKey, setEnvKey] = createSignal("")
  const [envVal, setEnvVal] = createSignal("")
  const [mode, setMode] = createSignal<OauthMode>(oauthMode(server().oauth as OauthValue | false | null | undefined))
  const [clientId, setClientId] = createSignal(initialOauth.clientId)
  const [clientSecret, setClientSecret] = createSignal(initialOauth.clientSecret)
  const [scopeValue, setScope] = createSignal(initialOauth.scope)
  const [callbackPort, setCallbackPort] = createSignal(initialOauth.callbackPort)
  const [redirectUri, setRedirectUri] = createSignal(initialOauth.redirectUri)
  const [oauthErrors, setOauthErrors] = createSignal<ReturnType<typeof validateOauth>>({})

  // Config writes are immediate. Text fields keep the typed value in a draft and commit on blur or Enter, so the
  // file and the live server are not rewritten on every keystroke; a committed key falls back to the config value.
  const [draft, setDraft] = createSignal<Record<string, string>>({})
  const text = (key: string, fallback: string) => draft()[key] ?? fallback
  const type = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }))
  const commit = (key: string, partial: Record<string, unknown>) => {
    setDraft((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    update(partial)
  }
  const commitOnEnter = (key: string, partial: () => Record<string, unknown>) => (event: KeyboardEvent) => {
    if (event.key === "Enter") commit(key, partial())
  }

  const update = (partial: Record<string, unknown>) => {
    // `value` reads a v2 data-store value, whose nested objects are store proxies: clone to plain data before the
    // host write, which posts the object across the webview boundary.
    const next = JSON.parse(JSON.stringify({ ...server(), ...partial })) as Record<string, unknown>
    if ("oauth" in partial && partial.oauth === undefined) delete next.oauth
    config.set(path(), next, scope())
  }

  const transport = () => {
    const type = server().type
    if (type === "local" || type === "remote") return type
    return server().url ? "remote" : "local"
  }

  const commandParts = (): string[] => {
    const command = server().command
    if (Array.isArray(command)) return command as string[]
    return typeof command === "string" ? [command] : []
  }

  const cmd = () => commandParts()[0] ?? ""
  const args = () => commandParts().slice(1).join("\n")
  const env = createMemo(() => Object.entries((server().environment as Record<string, string> | undefined) ?? {}))

  const addEnv = () => {
    const key = envKey().trim()
    if (!key) return
    update({ environment: { ...(server().environment as Record<string, string> | undefined), [key]: envVal().trim() } })
    setEnvKey("")
    setEnvVal("")
  }

  const removeEnv = (key: string) => {
    const existing = { ...((server().environment as Record<string, string> | undefined) ?? {}) }
    delete existing[key]
    update({ environment: existing })
  }

  const modeOptions: OauthMode[] = ["automatic", "disabled", "custom"]
  const modeLabel = (value: OauthMode) => language.t(`settings.agentBehaviour.editMcp.oauth.mode.${value}` as const)

  const currentFields = () => ({
    clientId: clientId(),
    clientSecret: clientSecret(),
    scope: scopeValue(),
    callbackPort: callbackPort(),
    redirectUri: redirectUri(),
  })

  const applyOauth = () => {
    const errors = validateOauth(mode(), currentFields())
    setOauthErrors(errors)
    if (Object.keys(errors).length > 0) return
    update({ oauth: oauthPatch(mode(), currentFields()) })
  }

  const selectMode = (next: OauthMode | undefined) => {
    if (!next) return
    setMode(next)
    setOauthErrors({})
    if (next !== "custom") {
      update({ oauth: oauthPatch(next, currentFields()) })
    }
  }

  return (
    <div>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "16px" }}>
        <div style={{ display: "flex", "align-items": "center" }}>
          <IconButton size="small" variant="ghost" icon="arrow-left" onClick={props.onBack} />
          <span style={{ "font-weight": "600", "font-size": "var(--kilo-font-size-14)", "margin-left": "8px" }}>
            {language.t("settings.agentBehaviour.editMcp")} — {props.name}
          </span>
        </div>
        <IconButton size="small" variant="ghost" icon="close" onClick={() => props.onRemove(props.name)} />
      </div>

      <Card style={{ "margin-bottom": "12px" }}>
        <div
          style={{
            "font-size": "var(--kilo-font-size-12)",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            padding: "4px 0",
          }}
        >
          {transport() === "local"
            ? language.t("settings.agentBehaviour.editMcp.transportLocal")
            : language.t("settings.agentBehaviour.editMcp.transportRemote")}
        </div>
      </Card>

      <Show when={transport() === "local"}>
        <Card style={{ "margin-bottom": "12px" }}>
          <div data-slot="settings-row-label-title" style={{ "margin-bottom": "8px" }}>
            {language.t("settings.agentBehaviour.addMcp.command")}
          </div>
          <TextField
            value={text("command", cmd())}
            placeholder={language.t("settings.agentBehaviour.addMcp.command.placeholder")}
            onChange={(val) => type("command", val)}
            onBlur={() =>
              commit("command", { type: "local", command: [text("command", cmd()).trim(), ...commandParts().slice(1)] })
            }
            onKeyDown={commitOnEnter("command", () => ({
              type: "local",
              command: [text("command", cmd()).trim(), ...commandParts().slice(1)],
            }))}
          />
        </Card>
        <Card style={{ "margin-bottom": "12px" }}>
          <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
            {language.t("settings.agentBehaviour.addMcp.args")}
          </div>
          <div data-slot="settings-row-label-subtitle" style={{ "margin-bottom": "8px" }}>
            {language.t("settings.agentBehaviour.addMcp.args.help")}
          </div>
          <TextField
            value={text("args", args())}
            placeholder={language.t("settings.agentBehaviour.addMcp.args.placeholder")}
            multiline
            onChange={(val) => type("args", val)}
            onBlur={() =>
              commit("args", {
                type: "local",
                command: [cmd(), ...text("args", args()).split(/\n/).filter(Boolean)],
              })
            }
          />
        </Card>
      </Show>

      <Show when={transport() === "remote"}>
        <Card style={{ "margin-bottom": "12px" }}>
          <div data-slot="settings-row-label-title" style={{ "margin-bottom": "8px" }}>
            {language.t("settings.agentBehaviour.addMcp.url")}
          </div>
          <TextField
            value={text("url", (server().url as string) ?? "")}
            placeholder={language.t("settings.agentBehaviour.addMcp.url.placeholder")}
            onChange={(val) => type("url", val)}
            onBlur={() => commit("url", { type: "remote", url: text("url", (server().url as string) ?? "").trim() })}
            onKeyDown={commitOnEnter("url", () => ({
              type: "remote",
              url: text("url", (server().url as string) ?? "").trim(),
            }))}
          />
        </Card>

        <Card style={{ "margin-bottom": "12px" }}>
          <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
            {language.t("settings.agentBehaviour.editMcp.oauth")}
          </div>
          <div data-slot="settings-row-label-subtitle" style={{ "margin-bottom": "8px" }}>
            {language.t("settings.agentBehaviour.editMcp.oauth.help")}
          </div>
          <div style={{ "margin-bottom": "8px" }}>
            <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
              {language.t("settings.agentBehaviour.editMcp.oauth.mode")}
            </div>
            <Select options={modeOptions} current={mode()} value={(m: OauthMode) => m} label={modeLabel} onSelect={selectMode} />
          </div>

          <Show when={mode() === "custom"}>
            <div style={{ "margin-bottom": "8px" }}>
              <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
                {language.t("settings.agentBehaviour.editMcp.oauth.clientId")}
              </div>
              <TextField value={clientId()} onChange={setClientId} onBlur={applyOauth} />
              <Show when={oauthErrors().clientId}>
                <div style={{ color: "var(--vscode-errorForeground)", "font-size": "var(--kilo-font-size-11)" }}>
                  {language.t(oauthErrors().clientId!)}
                </div>
              </Show>
            </div>
            <div style={{ "margin-bottom": "8px" }}>
              <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
                {language.t("settings.agentBehaviour.editMcp.oauth.clientSecret")}
              </div>
              <TextField type="password" value={clientSecret()} onChange={setClientSecret} onBlur={applyOauth} />
              <Show when={oauthErrors().secret}>
                <div style={{ color: "var(--vscode-errorForeground)", "font-size": "var(--kilo-font-size-11)" }}>
                  {language.t(oauthErrors().secret!)}
                </div>
              </Show>
            </div>
            <div style={{ "margin-bottom": "8px" }}>
              <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
                {language.t("settings.agentBehaviour.editMcp.oauth.scope")}
              </div>
              <TextField value={scopeValue()} onChange={setScope} onBlur={applyOauth} />
            </div>
            <div style={{ "margin-bottom": "8px" }}>
              <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
                {language.t("settings.agentBehaviour.editMcp.oauth.callbackPort")}
              </div>
              <TextField value={callbackPort()} onChange={setCallbackPort} onBlur={applyOauth} />
              <Show when={oauthErrors().callbackPort}>
                <div style={{ color: "var(--vscode-errorForeground)", "font-size": "var(--kilo-font-size-11)" }}>
                  {language.t(oauthErrors().callbackPort!)}
                </div>
              </Show>
            </div>
            <div>
              <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
                {language.t("settings.agentBehaviour.editMcp.oauth.redirectUri")}
              </div>
              <div data-slot="settings-row-label-subtitle" style={{ "margin-bottom": "4px" }}>
                {language.t("settings.agentBehaviour.editMcp.oauth.redirectUri.help")}
              </div>
              <TextField value={redirectUri()} onChange={setRedirectUri} onBlur={applyOauth} />
              <Show when={oauthErrors().redirectUri}>
                <div style={{ color: "var(--vscode-errorForeground)", "font-size": "var(--kilo-font-size-11)" }}>
                  {language.t(oauthErrors().redirectUri!)}
                </div>
              </Show>
            </div>
          </Show>
        </Card>
      </Show>

      <Show when={transport() === "local"}>
        <Card style={{ "margin-bottom": "12px" }}>
          <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
            {language.t("settings.agentBehaviour.editMcp.env")}
          </div>
          <div data-slot="settings-row-label-subtitle" style={{ "margin-bottom": "8px" }}>
            {language.t("settings.agentBehaviour.editMcp.env.help")}
          </div>

          <div
            style={{
              display: "flex",
              gap: "8px",
              "align-items": "center",
              padding: "8px 0",
              "border-bottom": env().length > 0 ? "1px solid var(--border-weak-base)" : "none",
            }}
          >
            <div style={{ flex: 1 }}>
              <TextField value={envKey()} placeholder="KEY" onChange={setEnvKey} />
            </div>
            <div style={{ flex: 1 }}>
              <TextField
                value={envVal()}
                placeholder="value"
                onChange={setEnvVal}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === "Enter") addEnv()
                }}
              />
            </div>
            <Button variant="secondary" onClick={addEnv}>
              {language.t("common.add")}
            </Button>
          </div>

          <For each={env()}>
            {([key, val], index) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  padding: "6px 0",
                  "border-bottom": index() < env().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                }}
              >
                <span
                  style={{
                    "font-family": "var(--vscode-editor-font-family, monospace)",
                    "font-size": "var(--kilo-font-size-12)",
                  }}
                >
                  {key}={val}
                </span>
                <IconButton size="small" variant="ghost" icon="close" onClick={() => removeEnv(key)} />
              </div>
            )}
          </For>
        </Card>
      </Show>

      <div style={{ display: "flex", "justify-content": "flex-end" }}>
        <Button variant="ghost" onClick={props.onBack}>
          {language.t("settings.agentBehaviour.editMode.back")}
        </Button>
      </div>
    </div>
  )
}

export default McpEditView
