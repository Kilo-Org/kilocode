import { Component, Show, createMemo, createSignal, For } from "solid-js"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Select } from "@kilocode/kilo-ui/select"

import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import type { McpConfig } from "../../types/messages"
import { mcpConfigScope, mcpEditPatch } from "./agent-behaviour-patches"
import { oauthMode, oauthPatch, validateOauth, type OauthFields, type OauthMode } from "./mcp-oauth-config"
import SettingsRow from "./SettingsRow"

interface Props {
  name: string
  onBack: () => void
  onRemove: (name: string) => void
}

const EMPTY_OAUTH_FIELDS: OauthFields = { clientId: "", clientSecret: "", scope: "", callbackPort: "", redirectUri: "" }

function oauthFieldsOf(cfg: McpConfig): OauthFields {
  const oauth = cfg.oauth
  if (!oauth) return EMPTY_OAUTH_FIELDS
  return {
    clientId: oauth.clientId ?? "",
    clientSecret: oauth.clientSecret ?? "",
    scope: oauth.scope ?? "",
    callbackPort: oauth.callbackPort ? String(oauth.callbackPort) : "",
    redirectUri: oauth.redirectUri ?? "",
  }
}

const McpEditView: Component<Props> = (props) => {
  const language = useLanguage()
  const { config, globalConfig, projectConfig, collections, updateConfig, updateGlobalConfig, updateProjectConfig } =
    useConfig()

  const target = () => mcpConfigScope(props.name, collections())
  const cfg = createMemo<McpConfig>(() => {
    const scoped = target() === "project" ? projectConfig() : target() === "global" ? globalConfig() : config()
    return scoped.mcp?.[props.name] ?? config().mcp?.[props.name] ?? {}
  })
  const initialOauth = oauthFieldsOf(cfg())

  const [envKey, setEnvKey] = createSignal("")
  const [envVal, setEnvVal] = createSignal("")
  const [mode, setMode] = createSignal<OauthMode>(oauthMode(cfg().oauth))
  const [clientId, setClientId] = createSignal(initialOauth.clientId)
  const [clientSecret, setClientSecret] = createSignal(initialOauth.clientSecret)
  const [scope, setScope] = createSignal(initialOauth.scope)
  const [callbackPort, setCallbackPort] = createSignal(initialOauth.callbackPort)
  const [redirectUri, setRedirectUri] = createSignal(initialOauth.redirectUri)
  const [oauthErrors, setOauthErrors] = createSignal<ReturnType<typeof validateOauth>>({})

  // The server's declaring config scope (project/global). Routing writes
  // through the matching updateProjectConfig/updateGlobalConfig call, rather
  // than always through the global-biased updateConfig, is what keeps a
  // project-scoped server's edits from being silently relocated to the
  // global config file.
  const update = (partial: Partial<McpConfig>) => {
    const next = mcpEditPatch(props.name, cfg(), partial)
    if (target() === "project") {
      updateProjectConfig(next)
      return
    }
    if (target() === "global") {
      updateGlobalConfig(next)
      return
    }
    updateConfig(next)
  }

  const transport = () => cfg().type ?? (cfg().url ? "remote" : "local")

  const cmd = () => {
    const c = cfg().command
    if (Array.isArray(c)) return c[0] ?? ""
    return c ?? ""
  }

  const args = () => {
    const c = cfg().command
    if (Array.isArray(c)) return c.slice(1).join("\n")
    return ""
  }

  const env = createMemo(() => Object.entries(cfg().environment ?? cfg().env ?? {}))

  const addEnv = () => {
    const key = envKey().trim()
    const val = envVal().trim()
    if (!key) return
    const existing = cfg().environment ?? cfg().env ?? {}
    update({ environment: { ...existing, [key]: val } })
    setEnvKey("")
    setEnvVal("")
  }

  const removeEnv = (key: string) => {
    const existing = { ...(cfg().environment ?? cfg().env ?? {}) }
    delete existing[key]
    update({ environment: existing })
  }

  const modeOptions: OauthMode[] = ["automatic", "disabled", "custom"]
  const modeLabel = (value: OauthMode) => language.t(`settings.agentBehaviour.editMcp.oauth.mode.${value}` as const)

  const currentFields = (): OauthFields => ({
    clientId: clientId(),
    clientSecret: clientSecret(),
    scope: scope(),
    callbackPort: callbackPort(),
    redirectUri: redirectUri(),
  })

  const applyOauth = () => {
    const current = mode()
    const errors = validateOauth(current, currentFields())
    setOauthErrors(errors)
    if (Object.keys(errors).length > 0) return
    update({ oauth: oauthPatch(current, currentFields()) })
  }

  const selectMode = (next: OauthMode | undefined) => {
    if (!next) return
    setMode(next)
    setOauthErrors({})
    if (next !== "custom") applyOauth()
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          "margin-bottom": "16px",
        }}
      >
        <div style={{ display: "flex", "align-items": "center" }}>
          <IconButton size="small" variant="ghost" icon="arrow-left" onClick={props.onBack} />
          <span style={{ "font-weight": "600", "font-size": "var(--kilo-font-size-14)", "margin-left": "8px" }}>
            {language.t("settings.agentBehaviour.editMcp")} — {props.name}
          </span>
        </div>
        <IconButton size="small" variant="ghost" icon="close" onClick={() => props.onRemove(props.name)} />
      </div>

      {/* Transport info */}
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

      {/* Command / URL */}
      <Show when={transport() === "local"}>
        <Card style={{ "margin-bottom": "12px" }}>
          <div data-slot="settings-row-label-title" style={{ "margin-bottom": "8px" }}>
            {language.t("settings.agentBehaviour.addMcp.command")}
          </div>
          <TextField
            value={cmd()}
            placeholder={language.t("settings.agentBehaviour.addMcp.command.placeholder")}
            onChange={(val) => {
              const existing = cfg().command
              const rest = Array.isArray(existing) ? existing.slice(1) : []
              update({ command: [val.trim(), ...rest] })
            }}
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
            value={args()}
            placeholder={language.t("settings.agentBehaviour.addMcp.args.placeholder")}
            multiline
            onChange={(val) => {
              const parts = val.split(/\n/).filter(Boolean)
              update({ command: [cmd(), ...parts] })
            }}
          />
        </Card>
      </Show>

      <Show when={transport() === "remote"}>
        <Card style={{ "margin-bottom": "12px" }}>
          <div data-slot="settings-row-label-title" style={{ "margin-bottom": "8px" }}>
            {language.t("settings.agentBehaviour.addMcp.url")}
          </div>
          <TextField
            value={cfg().url ?? ""}
            placeholder={language.t("settings.agentBehaviour.addMcp.url.placeholder")}
            onChange={(val) => update({ url: val.trim() || undefined })}
          />
        </Card>

        {/* OAuth configuration (remote servers only) */}
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
            <Select
              options={modeOptions}
              current={mode()}
              value={(m: OauthMode) => m}
              label={modeLabel}
              onSelect={selectMode}
            />
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
              <TextField value={scope()} onChange={setScope} onBlur={applyOauth} />
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

      {/* Environment variables (local servers only) */}
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
              <TextField value={envKey()} placeholder="KEY" onChange={(val) => setEnvKey(val)} />
            </div>
            <div style={{ flex: 1 }}>
              <TextField
                value={envVal()}
                placeholder="value"
                onChange={(val) => setEnvVal(val)}
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
