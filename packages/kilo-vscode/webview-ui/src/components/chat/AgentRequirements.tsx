/** @jsxImportSource solid-js */

import { For, Show, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useAgentRequirements } from "../../context/agent-requirements"
import { useLanguage } from "../../context/language"

export const AgentRequirements: Component = () => {
  const requirements = useAgentRequirements()
  const language = useLanguage()
  const result = requirements.result
  const install = (marketplace: string) => requirements.installs().find((item) => item.marketplace === marketplace)
  const failed = () => requirements.installs().some((item) => item.status === "failed")
  const extensions = () => result()?.vscode_extensions ?? []
  const mcps = () => result()?.mcps ?? []
  const total = () => (result()?.skills.length ?? 0) + extensions().length + mcps().length
  const missingSkills = () => result()?.skills.some((skill) => skill.status === "missing") === true
  const installError = (progress: NonNullable<ReturnType<typeof install>>) => {
    if (progress.code === "skill_not_found") return language.t("agentRequirements.install.error.skillNotFound")
    if (progress.code === "item_not_skill") return language.t("agentRequirements.install.error.itemNotSkill")
    if (progress.code === "unavailable") return language.t("agentRequirements.install.error.unavailable")
    const message =
      progress.code === "marketplace_unavailable"
        ? language.t("agentRequirements.install.error.marketplaceUnavailable")
        : language.t("agentRequirements.skill.installFailed")
    return progress.error ? language.t("agentRequirements.error.detail", { message, error: progress.error }) : message
  }

  const resultError = () => {
    const error = result()?.error
    if (!error) return undefined
    if (error.code === "unknown_agent") return language.t("agentRequirements.error.unknownAgent")
    if (error.code === "malformed_declaration") return language.t("agentRequirements.error.malformedDeclaration")
    if (error.code === "discovery_failed") return language.t("agentRequirements.error.discoveryFailed")
    if (error.code === "scope_mismatch") return language.t("agentRequirements.error.scopeMismatch")
    return language.t("agentRequirements.error.requestFailed")
  }

  // Merge backend status with live installation progress for each skill.
  const detail = (skill: NonNullable<ReturnType<typeof result>>["skills"][number]) => {
    const progress = install(skill.marketplace)
    if (progress?.status === "installing") return language.t("agentRequirements.skill.installing")
    if (progress?.status === "succeeded") return language.t("agentRequirements.skill.verifying")
    if (progress?.status === "failed") return installError(progress)
    if (skill.status === "ready") return language.t("agentRequirements.skill.installed")
    if (skill.status === "error") return language.t("agentRequirements.skill.checkFailed")
    return language.t("agentRequirements.skill.missing")
  }

  const tone = (skill: NonNullable<ReturnType<typeof result>>["skills"][number]) => {
    const progress = install(skill.marketplace)
    if (progress?.status === "failed" || skill.status === "error") return "error"
    if (skill.status === "ready" || progress?.status === "succeeded") return "ready"
    if (progress?.status === "installing") return "installing"
    return "missing"
  }

  const extensionTone = (extension: NonNullable<ReturnType<typeof result>>["vscode_extensions"][number]) => {
    if (extension.status === "ready") return "ready"
    if (extension.status === "error") return "error"
    return "missing"
  }

  const Status = (props: { status: "ready" | "missing" | "installing" | "error" }) => (
    <span data-slot="agent-requirements-status" data-status={props.status} aria-hidden="true">
      <Show when={props.status === "ready"}>
        <Icon name="circle-check" size="small" />
      </Show>
      <Show when={props.status === "missing"}>
        <Icon name="warning" size="small" />
      </Show>
      <Show when={props.status === "installing"}>
        <Spinner />
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
          <h2 data-slot="agent-requirements-title">{language.t("agentRequirements.blocked.title")}</h2>
          <p data-slot="agent-requirements-description">{language.t("agentRequirements.blocked.description")}</p>
        </div>

        <Show when={resultError()} keyed>
          {(error) => <div class="agent-requirements-error">{error}</div>}
        </Show>

        <Show when={total()}>
          <div data-slot="agent-requirements-options">
            <Show when={result()!.skills.length}>
              <section class="agent-requirements-group">
                <h3 data-slot="agent-requirements-group-title">{language.t("agentRequirements.group.skills")}</h3>
                <ul data-slot="agent-requirements-list">
                  <For each={result()!.skills}>
                    {(skill) => {
                      const status = () => tone(skill)
                      return (
                        <li class="agent-requirements-line" data-status={status()}>
                          <Status status={status()} />
                          <div data-slot="agent-requirements-line-row">
                            <span data-slot="agent-requirements-line-name">{skill.name}</span>
                            <span data-slot="agent-requirements-line-detail">{detail(skill)}</span>
                          </div>
                        </li>
                      )
                    }}
                  </For>
                </ul>
              </section>
            </Show>
            <Show when={mcps().length}>
              <section class="agent-requirements-group">
                <h3 data-slot="agent-requirements-group-title">{language.t("agentRequirements.group.mcps")}</h3>
                <ul data-slot="agent-requirements-list">
                  <For each={mcps()}>
                    {(mcp) => (
                      <li class="agent-requirements-line" data-status="ready">
                        <Status status="ready" />
                        <div data-slot="agent-requirements-line-row">
                          <span data-slot="agent-requirements-line-name">{mcp}</span>
                          <span data-slot="agent-requirements-line-detail">
                            {language.t("agentRequirements.skill.installed")}
                          </span>
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            </Show>
            <Show when={extensions().length}>
              <section class="agent-requirements-group">
                <h3 data-slot="agent-requirements-group-title">{language.t("agentRequirements.group.extensions")}</h3>
                <ul data-slot="agent-requirements-list">
                  <For each={extensions()}>
                    {(extension) => {
                      const status = () => extensionTone(extension)
                      const detail = () => {
                        if (extension.status === "ready") return language.t("agentRequirements.skill.installed")
                        if (extension.status === "error") return language.t("agentRequirements.extension.checkFailed")
                        return language.t("agentRequirements.extension.missing")
                      }
                      return (
                        <li class="agent-requirements-line" data-status={status()}>
                          <Status status={status()} />
                          <div data-slot="agent-requirements-line-row">
                            <span data-slot="agent-requirements-line-name">{extension.name}</span>
                            <span data-slot="agent-requirements-line-detail">{detail()}</span>
                          </div>
                        </li>
                      )
                    }}
                  </For>
                </ul>
              </section>
            </Show>
          </div>
        </Show>

        <Show when={result()?.state !== "ready" && !requirements.checking()}>
          <div class="agent-requirements-actions">
            <Show when={missingSkills()}>
              <Button variant="primary" onClick={requirements.installAll} disabled={requirements.installing()}>
                {requirements.installing()
                  ? language.t("agentRequirements.action.installing")
                  : language.t("agentRequirements.action.installAll")}
              </Button>
            </Show>
            <Button variant="secondary" onClick={requirements.retry} disabled={requirements.installing()}>
              {language.t("common.retry")}
            </Button>
          </div>
          <Show when={failed()}>
            <p class="agent-requirements-note">{language.t("agentRequirements.install.partialFailure")}</p>
          </Show>
        </Show>
      </Card>
    </div>
  )
}
