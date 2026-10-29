// The MCP Servers subtab. It lists the servers from `mcp.servers` with their live status (from the MCP client),
// and each row exposes: expandable details, an enable switch, sign-in for OAuth remotes, reset sign-in, remove,
// and an edit view. The row writes config through `useSettingsConfig`, in the scope that defines the server.
import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useLanguage } from "../../../context/language"
import { useSettingsConfig } from "../../../v2/settings-config"
import { createMcp } from "../../../v2/mcp"
import McpEditView from "./McpEditView"
import SettingsRow from "../SettingsRow"
import Switch from "../Switch"

const STATUS_KEYS: Record<string, string> = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
}

const McpSubtab: Component = () => {
  const language = useLanguage()
  const config = useSettingsConfig()
  const mcp = createMcp()
  const dialog = useDialog()

  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})
  const [editing, setEditing] = createSignal("")

  const entries = createMemo(() =>
    Object.entries((config.value(["mcp", "servers"]) ?? {}) as Record<string, Record<string, unknown>>),
  )

  const servers = () => config.value(["mcp", "servers"]) as Record<string, Record<string, unknown>> | undefined

  const scopeFor = (name: string) => config.source(["mcp", "servers", name])
  const statusOf = (name: string) => mcp.status(name)
  const isConnected = (name: string) => statusOf(name)?.status === "connected"
  const needsAuth = (name: string) => statusOf(name)?.status === "needs_auth"
  const isSigningIn = (name: string) => mcp.busy().includes(name)
  const isRemoving = (name: string) => mcp.removing().includes(name)
  const transportOf = (name: string) => {
    const server = servers()?.[name] ?? {}
    const type = server.type
    if (type === "local" || type === "remote") return type
    return server.url ? "remote" : "local"
  }
  const errorOf = (name: string) => {
    const status = statusOf(name)
    return status?.status === "failed" ? status.error : undefined
  }
  const detailVisible = (name: string) => statusOf(name)?.status !== "needs_auth"

  const statusColor = (name: string) => {
    const status = statusOf(name)?.status
    if (status === "connected") return "var(--vscode-testing-iconPassed, #4caf50)"
    if (status === "failed") return "var(--vscode-testing-iconFailed, #f44336)"
    if (status === "needs_auth") return "var(--vscode-editorWarning-foreground, #ff9800)"
    return "var(--vscode-disabledForeground, #888)"
  }

  const statusLabel = (name: string) => {
    const status = statusOf(name)?.status
    if (!status) return ""
    const key = STATUS_KEYS[status]
    return key ? language.t(key) : status
  }

  const toggle = (name: string) => setExpanded((prev) => ({ ...prev, [name]: !prev[name] }))

  const confirmRemove = (name: string) => {
    dialog.show(() => (
      <Dialog title={language.t("settings.agentBehaviour.removeMcp.title")} fit>
        <div class="dialog-confirm-body">
          <span>{language.t("settings.agentBehaviour.removeMcp.confirm", { name })}</span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                dialog.close()
                const scope = scopeFor(name) ?? "global"
                config.unset(["mcp", "servers", name], scope)
              }}
            >
              {language.t("settings.agentBehaviour.removeMcp.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  const confirmReset = (name: string) => {
    dialog.show(() => (
      <Dialog title={language.t("settings.agentBehaviour.mcpResetAuth.title")} fit>
        <div class="dialog-confirm-body">
          <span>{language.t("settings.agentBehaviour.mcpResetAuth.confirm", { name })}</span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                dialog.close()
                setTimeout(() => void mcp.reset(name), 150)
              }}
            >
              {language.t("settings.agentBehaviour.mcpResetAuth")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  const toggleEnabled = (name: string, enabled: boolean) => {
    const scope = scopeFor(name)
    if (scope) config.set(["mcp", "servers", name, "disabled"], !enabled, scope)
    if (!enabled) void mcp.disconnect(name)
    else void mcp.connect(name)
  }

  const timeoutScope = () => config.source(["mcp", "timeout"]) ?? "global"
  const timeoutValue = (key: string) => {
    const value = config.value(["mcp", "timeout", key])
    return value === undefined || value === null ? "" : String(value)
  }
  const setTimeoutValue = (key: string, value: string) => {
    const trimmed = value.trim()
    config.set(["mcp", "timeout", key], trimmed === "" ? undefined : Number(trimmed), timeoutScope())
  }

  return (
    <Show
      when={!editing()}
      fallback={
        <McpEditView
          name={editing()}
          onBack={() => setEditing("")}
          onRemove={(name) => {
            confirmRemove(name)
            setEditing("")
          }}
        />
      }
    >
      <div>
        <Show
          when={entries().length > 0}
          fallback={
            <Card>
              <div
                style={{
                  "font-size": "var(--kilo-font-size-12)",
                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                }}
              >
                {language.t("settings.agentBehaviour.mcpEmpty")}
              </div>
            </Card>
          }
        >
          <Card>
            <For each={entries()}>
              {([name, server], index) => {
                const open = () => expanded()[name] ?? false
                const env = () => Object.entries((server.environment as Record<string, string> | undefined) ?? {})
                const command = () => {
                  const value = server.command
                  if (Array.isArray(value)) return value as string[]
                  return typeof value === "string" ? [value] : []
                }
                return (
                  <div
                    style={{
                      "border-bottom": index() < entries().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "space-between",
                        padding: "8px 0",
                        cursor: "pointer",
                      }}
                      onClick={() => toggle(name)}
                    >
                      <div style={{ display: "flex", "align-items": "center", gap: "6px", flex: 1, "min-width": 0 }}>
                        <IconButton
                          size="small"
                          variant="ghost"
                          icon={open() ? "chevron-down" : "chevron-right"}
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation()
                            toggle(name)
                          }}
                        />
                        <div
                          style={{
                            width: "6px",
                            height: "6px",
                            "border-radius": "50%",
                            "background-color": statusColor(name),
                            "flex-shrink": "0",
                          }}
                        />
                        <div style={{ "font-weight": "500" }}>{name}</div>
                        <Show when={detailVisible(name)}>
                          <Show
                            when={errorOf(name)}
                            fallback={
                              <span
                                style={{
                                  "font-size": "var(--kilo-font-size-10)",
                                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                                }}
                              >
                                {statusLabel(name) || (server.url ? "remote" : "stdio")}
                              </span>
                            }
                          >
                            <Tooltip
                              value={
                                <>
                                  {statusLabel(name)}
                                  <br />
                                  {errorOf(name)}
                                </>
                              }
                              placement="top"
                            >
                              <span
                                style={{
                                  "font-size": "var(--kilo-font-size-10)",
                                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                                  "text-decoration": "underline dotted",
                                }}
                              >
                                {statusLabel(name)}
                              </span>
                            </Tooltip>
                          </Show>
                        </Show>
                      </div>
                      <div style={{ display: "flex", gap: "4px", "align-items": "center" }}>
                        <Show when={isRemoving(name)}>
                          <div
                            style={{
                              display: "flex",
                              "align-items": "center",
                              gap: "6px",
                              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                              "font-size": "var(--kilo-font-size-12)",
                            }}
                          >
                            <Spinner />
                            <span>{language.t("settings.agentBehaviour.mcpRemoving")}</span>
                          </div>
                        </Show>
                        <Show when={needsAuth(name) && !isRemoving(name)}>
                          <div onClick={(e: MouseEvent) => e.stopPropagation()}>
                            <Show
                              when={isSigningIn(name)}
                              fallback={
                                <Button variant="primary" size="small" onClick={() => void mcp.signIn(name)}>
                                  {language.t("common.signIn")}
                                </Button>
                              }
                            >
                              <Button variant="ghost" size="small" onClick={() => mcp.cancel(name)}>
                                {language.t("settings.agentBehaviour.mcpSignIn.cancel")}
                              </Button>
                            </Show>
                          </div>
                        </Show>
                        <Show when={!needsAuth(name) && !isRemoving(name)}>
                          <div onClick={(e: MouseEvent) => e.stopPropagation()}>
                            <Switch
                              checked={isConnected(name)}
                              disabled={isSigningIn(name)}
                              onChange={(enabled) => toggleEnabled(name, enabled)}
                            >
                              <span class="sr-only">{name}</span>
                            </Switch>
                          </div>
                        </Show>
                        <Show when={!isRemoving(name) && isConnected(name) && transportOf(name) === "remote"}>
                          <div onClick={(e: MouseEvent) => e.stopPropagation()}>
                            <Button variant="ghost" size="small" onClick={() => confirmReset(name)}>
                              {language.t("settings.agentBehaviour.mcpResetAuth")}
                            </Button>
                          </div>
                        </Show>
                        <IconButton
                          size="small"
                          variant="ghost"
                          icon="close"
                          disabled={isRemoving(name)}
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation()
                            confirmRemove(name)
                          }}
                        />
                        <IconButton
                          size="small"
                          variant="ghost"
                          icon="chevron-right"
                          disabled={isRemoving(name)}
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation()
                            setEditing(name)
                          }}
                        />
                      </div>
                    </div>

                    <Show when={errorOf(name)}>
                      <div
                        style={{
                          "padding-left": "28px",
                          "padding-bottom": "4px",
                          "font-size": "var(--kilo-font-size-11)",
                          color: "var(--vscode-errorForeground)",
                        }}
                      >
                        {errorOf(name)}
                      </div>
                    </Show>

                    <Show when={open()}>
                      <div
                        style={{
                          "padding-left": "28px",
                          "padding-bottom": "8px",
                          "font-size": "var(--kilo-font-size-12)",
                          color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                        }}
                      >
                        <Show when={command().length > 0}>
                          <div style={{ "margin-bottom": "4px" }}>
                            <span style={{ "font-weight": "500" }}>
                              {language.t("settings.agentBehaviour.mcpDetail.command")}:{" "}
                            </span>
                            <span style={{ "font-family": "var(--vscode-editor-font-family, monospace)" }}>
                              {command()[0]}
                            </span>
                          </div>
                          <Show when={command().length > 1}>
                            <div style={{ "margin-bottom": "4px" }}>
                              <span style={{ "font-weight": "500" }}>
                                {language.t("settings.agentBehaviour.mcpDetail.args")}:{" "}
                              </span>
                              <span style={{ "font-family": "var(--vscode-editor-font-family, monospace)" }}>
                                {command().slice(1).join(" ")}
                              </span>
                            </div>
                          </Show>
                        </Show>
                        <Show when={server.url}>
                          <div style={{ "margin-bottom": "4px" }}>
                            <span style={{ "font-weight": "500" }}>URL: </span>
                            <span style={{ "font-family": "var(--vscode-editor-font-family, monospace)" }}>
                              {server.url as string}
                            </span>
                          </div>
                        </Show>
                        <Show when={env().length > 0}>
                          <div style={{ "margin-bottom": "4px" }}>
                            <span style={{ "font-weight": "500" }}>
                              {language.t("settings.agentBehaviour.mcpDetail.env")}:
                            </span>
                          </div>
                          <For each={env()}>
                            {([key, value]) => (
                              <div
                                style={{
                                  "padding-left": "8px",
                                  "font-family": "var(--vscode-editor-font-family, monospace)",
                                }}
                              >
                                {key}={value}
                              </div>
                            )}
                          </For>
                        </Show>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </Card>
        </Show>

        <Card style={{ "margin-top": "16px" }}>
          <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
            {language.t("settings.experimental.mcpTimeout.title")}
          </div>
          <div data-slot="settings-row-label-subtitle" style={{ "margin-bottom": "8px" }}>
            {language.t("settings.experimental.mcpTimeout.description")}
          </div>
          <For each={["startup", "catalog", "execution"] as const}>
            {(key, index) => (
              <SettingsRow
                title={language.t(`settings.agentBehaviour.mcp.timeout.${key}.title`)}
                last={index() === 2}
              >
                <TextField
                  value={timeoutValue(key)}
                  placeholder={language.t("settings.experimental.mcpTimeout.title")}
                  onChange={(value) => setTimeoutValue(key, value)}
                />
              </SettingsRow>
            )}
          </For>
        </Card>
      </div>
    </Show>
  )
}

export default McpSubtab
