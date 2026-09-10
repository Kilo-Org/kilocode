/** @jsxImportSource solid-js */

import { For, Show, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useAgentRequirements } from "../../context/agent-requirements"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { AgentRequirementMCP, AgentRequirementSkill, AgentRequirementVSCodeExtension } from "../../types/messages"

type Status = "ready" | "missing" | "error"

export const AgentRequirements: Component = () => {
  const requirements = useAgentRequirements()
  const language = useLanguage()
  const vscode = useVSCode()
  const result = requirements.result
  const skills = () => result()?.skills ?? []
  const mcps = () => result()?.mcps ?? []
  const extensions = () => result()?.vscode_extensions ?? []
  const total = () => skills().length + mcps().length + extensions().length
  const marketplace = () =>
    skills().some((item) => item.status !== "ready") || mcps().some((item) => item.status !== "ready")
  const tools = () => {
    if (skills().length && mcps().length) {
      return `${language.t("agentRequirements.group.skills")} / ${language.t("agentRequirements.group.mcps")}`
    }
    if (skills().length) return language.t("agentRequirements.group.skills")
    return language.t("agentRequirements.group.mcps")
  }
  const open = () => {
    const current = result()
    if (!current) return
    vscode.postMessage({ type: "openMarketplacePanel", directory: current.directory })
  }
  const title = () =>
    (result()?.agent ?? "")
      .split(/[-_]/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")

  const error = () => {
    const err = result()?.error
    if (!err) return undefined
    if (err.code === "unknown_agent") return language.t("agentRequirements.error.unknownAgent")
    if (err.code === "malformed_declaration") return language.t("agentRequirements.error.malformedDeclaration")
    if (err.code === "discovery_failed") return language.t("agentRequirements.error.discoveryFailed")
    if (err.code === "mcp_status_failed") return language.t("agentRequirements.error.mcpStatusFailed")
    if (err.code === "scope_mismatch") return language.t("agentRequirements.error.scopeMismatch")
    return err.message || language.t("agentRequirements.error.requestFailed")
  }

  const skill = (item: AgentRequirementSkill) => {
    if (item.message) return item.message
    if (item.status === "ready") return language.t("agentRequirements.skill.installed")
    if (item.status === "error") return language.t("agentRequirements.skill.checkFailed")
    return language.t("agentRequirements.skill.missing")
  }

  const mcp = (item: AgentRequirementMCP) => {
    if (item.message) return item.message
    if (item.status === "ready") return language.t("agentRequirements.mcp.connected")
    if (item.status === "error") return language.t("agentRequirements.mcp.checkFailed")
    return language.t("agentRequirements.mcp.missing")
  }

  const extension = (item: AgentRequirementVSCodeExtension) => {
    if (item.message) return item.message
    if (item.status === "ready") return language.t("agentRequirements.extension.installed")
    if (item.status === "error") return language.t("agentRequirements.extension.checkFailed")
    return language.t("agentRequirements.extension.missing")
  }

  const StatusIcon = (props: { status: Status }) => (
    <span data-slot="agent-requirements-status" data-status={props.status} aria-hidden="true">
      <Show when={props.status === "ready"}>
        <Icon name="circle-check" size="small" />
      </Show>
      <Show when={props.status === "missing"}>
        <Icon name="warning" size="small" />
      </Show>
      <Show when={props.status === "error"}>
        <Icon name="circle-x" size="small" />
      </Show>
    </span>
  )

  return (
    <div class="agent-requirements" role="status" aria-live="polite" aria-atomic="false">
      <Card class="agent-requirements-card">
        <div data-slot="agent-requirements-copy">
          <h2 data-slot="agent-requirements-title">
            {language.t("agentRequirements.blocked.title", { agent: title() })}
          </h2>
          <p data-slot="agent-requirements-description">{language.t("agentRequirements.blocked.description")}</p>
        </div>

        <Show when={error()} keyed>
          {(message) => <div class="agent-requirements-error">{message}</div>}
        </Show>

        <Show when={total()}>
          <div data-slot="agent-requirements-options">
            <Show when={skills().length || mcps().length}>
              <section class="agent-requirements-category">
                <h3 data-slot="agent-requirements-category-title">{tools()}</h3>
                <div data-slot="agent-requirements-category-content">
                  <Show when={skills().length}>
                    <div class="agent-requirements-group">
                      <h4 data-slot="agent-requirements-group-title">{language.t("agentRequirements.group.skills")}</h4>
                      <ul data-slot="agent-requirements-list">
                        <For each={skills()}>
                          {(item) => (
                            <li class="agent-requirements-line" data-status={item.status}>
                              <StatusIcon status={item.status} />
                              <div data-slot="agent-requirements-line-row">
                                <span data-slot="agent-requirements-line-name">{item.name}</span>
                                <span data-slot="agent-requirements-line-detail">{skill(item)}</span>
                              </div>
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                  </Show>
                  <Show when={mcps().length}>
                    <div class="agent-requirements-group">
                      <h4 data-slot="agent-requirements-group-title">{language.t("agentRequirements.group.mcps")}</h4>
                      <ul data-slot="agent-requirements-list">
                        <For each={mcps()}>
                          {(item) => (
                            <li class="agent-requirements-line" data-status={item.status}>
                              <StatusIcon status={item.status} />
                              <div data-slot="agent-requirements-line-row">
                                <span data-slot="agent-requirements-line-name">{item.name}</span>
                                <span data-slot="agent-requirements-line-detail">{mcp(item)}</span>
                              </div>
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                  </Show>
                  <Show when={marketplace()}>
                    <div class="agent-requirements-actions">
                      <Button variant="primary" onClick={open}>
                        {language.t("agentRequirements.action.openMarketplace")}
                      </Button>
                    </div>
                  </Show>
                </div>
              </section>
            </Show>

            <Show when={extensions().length}>
              <section class="agent-requirements-category">
                <div data-slot="agent-requirements-category-copy">
                  <h3 data-slot="agent-requirements-category-title">
                    {language.t("agentRequirements.group.extensions")}
                  </h3>
                  <p data-slot="agent-requirements-category-description">
                    {language.t("agentRequirements.extension.description")}
                  </p>
                </div>
                <div data-slot="agent-requirements-category-content">
                  <div class="agent-requirements-group">
                    <ul data-slot="agent-requirements-list">
                      <For each={extensions()}>
                        {(item) => (
                          <li class="agent-requirements-line" data-status={item.status}>
                            <StatusIcon status={item.status} />
                            <div data-slot="agent-requirements-line-row">
                              <span data-slot="agent-requirements-line-name">
                                {item.name} ({item.id})
                              </span>
                              <span data-slot="agent-requirements-line-detail">{extension(item)}</span>
                            </div>
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                </div>
              </section>
            </Show>
          </div>
        </Show>
      </Card>
    </div>
  )
}
