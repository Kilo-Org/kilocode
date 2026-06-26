/**
 * StackPopover — prompt-area popup summarizing the user's configured stack
 * (technologies), MCP servers, and skills. A status circle on the trigger
 * turns colored when any of the three is present; gray otherwise.
 *
 * Gear icons open the Stack Builder panel (Stack) or the Kilo Settings
 * Agent Behaviour subtabs (MCP / Skills).
 */

import { createMemo, createSignal, For, Show, createEffect } from "solid-js"
import type { Component } from "solid-js"
import { PopupSelector } from "./PopupSelector"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Switch } from "@kilocode/kilo-ui/switch"
import { useConfig } from "../../context/config"
import { useSession } from "../../context/session"
import { useStackSummary } from "../../context/stack-summary"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"

const StackPopover: Component = () => {
  const language = useLanguage()
  const { config, updateConfig } = useConfig()
  const session = useSession()
  const vscode = useVSCode()
  const stack = useStackSummary()
  const [open, setOpen] = createSignal(false)

  const mcpEntries = createMemo(() => Object.entries(config().mcp ?? {}))
  const enabledMcps = createMemo(() => mcpEntries().filter(([, cfg]) => cfg.enabled !== false))
  const skills = createMemo(() => session.skills())

  const active = createMemo(() => stack.configured() || enabledMcps().length > 0 || skills().length > 0)

  // Refresh all three sections whenever the popover opens.
  createEffect(() => {
    if (!open()) return
    stack.refresh()
    session.refreshSkills()
  })

  const openStackBuilder = () => {
    vscode.postMessage({ type: "openStackBuilder" })
    setOpen(false)
  }
  const openMcpSettings = () => {
    vscode.postMessage({ type: "openSettingsPanel", tab: "agentBehaviour", subtab: "mcpServers" })
    setOpen(false)
  }
  const openSkillsSettings = () => {
    vscode.postMessage({ type: "openSettingsPanel", tab: "agentBehaviour", subtab: "skills" })
    setOpen(false)
  }

  const toggleMcp = (name: string, enabled: boolean) => {
    const entries = config().mcp ?? {}
    const existing = entries[name] ?? {}
    updateConfig({ mcp: { ...entries, [name]: { ...existing, enabled } } })
  }

  return (
    <Tooltip value={language.t("prompt.stack.title")} placement="top">
      <PopupSelector
        expanded={false}
        preferredWidth={320}
        preferredHeight={300}
        minHeight={150}
        placement="top-start"
        open={open()}
        onOpenChange={setOpen}
        triggerAs={Button}
        triggerProps={{
          variant: "ghost",
          size: "small",
          get class() {
            return `prompt-stack-button ${active() ? "prompt-stack-button--active" : ""}`
          },
          get ["aria-label"]() {
            return language.t("prompt.stack.title")
          },
        }}
        trigger={<Icon name="layers" size="small" />}
        class="stack-popover"
      >
        {(bodyH) => (
          <div class="stack-popover-body" style={bodyH() !== undefined ? { height: `${bodyH()}px` } : {}}>
            <div class="stack-popover-scroll">
              {/* Stack section */}
              <div class="stack-popover-section">
                <div class="stack-popover-header">
                  <span class="stack-popover-header-label">{language.t("prompt.stack.section.stack")}</span>
                  <Tooltip value={language.t("prompt.stack.gear.stack")} placement="top">
                    <IconButton
                      icon="settings-gear"
                      size="small"
                      variant="ghost"
                      aria-label={language.t("prompt.stack.gear.stack")}
                      onClick={openStackBuilder}
                    />
                  </Tooltip>
                </div>
                <Show
                  when={stack.technologies().length > 0}
                  fallback={<div class="stack-popover-empty">{language.t("prompt.stack.notConfigured")}</div>}
                >
                  <div class="stack-popover-list">
                    <For each={stack.technologies()}>
                      {(tech) => (
                        <div class="stack-popover-item">
                          <Icon name="layers" size="small" />
                          <span>{tech.name}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              {/* MCP section */}
              <div class="stack-popover-section">
                <div class="stack-popover-header">
                  <span class="stack-popover-header-label">{language.t("prompt.stack.section.mcp")}</span>
                  <Tooltip value={language.t("prompt.stack.gear.mcp")} placement="top">
                    <IconButton
                      icon="settings-gear"
                      size="small"
                      variant="ghost"
                      aria-label={language.t("prompt.stack.gear.mcp")}
                      onClick={openMcpSettings}
                    />
                  </Tooltip>
                </div>
                <Show
                  when={mcpEntries().length > 0}
                  fallback={<div class="stack-popover-empty">{language.t("prompt.stack.noMcps")}</div>}
                >
                  <div class="stack-popover-list">
                    <For each={mcpEntries()}>
                      {([name, cfg]) => {
                        const status = createMemo(() => session.mcpStatus()[name]?.status)
                        const enabled = createMemo(() => cfg.enabled !== false)
                        return (
                          <div class="stack-popover-item stack-popover-item--mcp">
                            <span
                              class={`stack-popover-mcp-dot stack-popover-mcp-dot--${status() ?? "disabled"}`}
                              aria-hidden="true"
                            />
                            <span class="stack-popover-item-name">{name}</span>
                            <Switch checked={enabled()} onChange={(checked) => toggleMcp(name, checked)} hideLabel>
                              {name}
                            </Switch>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </Show>
              </div>

              {/* Skills section */}
              <div class="stack-popover-section">
                <div class="stack-popover-header">
                  <span class="stack-popover-header-label">{language.t("prompt.stack.section.skills")}</span>
                  <Tooltip value={language.t("prompt.stack.gear.skills")} placement="top">
                    <IconButton
                      icon="settings-gear"
                      size="small"
                      variant="ghost"
                      aria-label={language.t("prompt.stack.gear.skills")}
                      onClick={openSkillsSettings}
                    />
                  </Tooltip>
                </div>
                <Show
                  when={skills().length > 0}
                  fallback={<div class="stack-popover-empty">{language.t("prompt.stack.noSkills")}</div>}
                >
                  <div class="stack-popover-list">
                    <For each={skills()}>
                      {(skill) => (
                        <div class="stack-popover-item">
                          <Icon name="sliders" size="small" />
                          <span>{skill.name}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        )}
      </PopupSelector>
    </Tooltip>
  )
}

export default StackPopover
