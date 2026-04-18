import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { Button } from "@devilcode/kilo-ui/button"
import { Card } from "@devilcode/kilo-ui/card"
import { IconButton } from "@devilcode/kilo-ui/icon-button"
import { Switch } from "@devilcode/kilo-ui/switch"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import type { TeamConfig } from "../../types/messages"
import TeamRoleEditor from "./TeamRoleEditor"
import TeamRoutingPanel from "./TeamRoutingPanel"
import TeamTemplateGallery from "./TeamTemplateGallery"
import TeamDelegationGraph from "./TeamDelegationGraph"

type TeamSubtab = "roles" | "routing" | "templates"
type RoleView = "list" | "create" | "edit"

const emptyTeamConfig: TeamConfig = {
  enabled: false,
  roles: {},
  routing: {
    strategy: "hierarchical",
    defaultRole: "",
    escalationEnabled: true,
  },
  reactions: [],
}

const TeamTab: Component = () => {
  const language = useLanguage()
  const { config, updateConfig } = useConfig()
  const [activeSubtab, setActiveSubtab] = createSignal<TeamSubtab>("roles")
  const [roleView, setRoleView] = createSignal<RoleView>("list")
  const [editingRole, setEditingRole] = createSignal<string>("")

  const team = createMemo<TeamConfig>(() => {
    const incoming = config().team
    if (!incoming) return emptyTeamConfig
    return {
      enabled: incoming.enabled ?? false,
      roles: incoming.roles ?? {},
      routing: incoming.routing ?? emptyTeamConfig.routing,
      reactions: incoming.reactions ?? [],
    }
  })

  const roleEntries = createMemo(() => Object.entries(team().roles))

  const saveTeam = (nextTeam: TeamConfig) => {
    updateConfig({ team: nextTeam })
  }

  const toggleTeamEnabled = (enabled: boolean) => {
    const next = { ...team(), enabled }
    saveTeam(next)
    if (enabled && Object.keys(next.roles).length === 0) {
      setActiveSubtab("templates")
    }
  }

  const deleteRole = (roleID: string) => {
    const roles = { ...team().roles }
    delete roles[roleID]
    const defaultRole =
      team().routing.defaultRole === roleID ? (Object.keys(roles)[0] ?? "") : team().routing.defaultRole
    saveTeam({
      ...team(),
      roles,
      routing: {
        ...team().routing,
        defaultRole,
      },
    })
  }

  return (
    <div>
      <Card style={{ "margin-bottom": "12px" }}>
        <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", gap: "8px" }}>
          <div>
            <div style={{ "font-size": "13px", "font-weight": "600" }}>{language.t("settings.team.enabled")}</div>
            <div style={{ "font-size": "12px", color: "var(--text-weak-base)" }}>
              {language.t("settings.team.enabled.description")}
            </div>
          </div>
          <Switch checked={team().enabled} onChange={toggleTeamEnabled} hideLabel>
            {language.t("settings.team.enabled")}
          </Switch>
        </div>
      </Card>

      <div
        style={{
          display: "flex",
          gap: "0",
          "border-bottom": "1px solid var(--vscode-panel-border)",
          "margin-bottom": "12px",
        }}
      >
        <For
          each={[
            { id: "roles", key: "settings.team.subtab.roles" },
            { id: "routing", key: "settings.team.subtab.routing" },
            { id: "templates", key: "settings.team.subtab.templates" },
          ]}
        >
          {(item) => (
            <button
              style={{
                border: "none",
                background: "transparent",
                padding: "8px 14px",
                "font-size": "13px",
                cursor: "pointer",
                color:
                  activeSubtab() === (item.id as TeamSubtab)
                    ? "var(--vscode-foreground)"
                    : "var(--vscode-descriptionForeground)",
                "border-bottom":
                  activeSubtab() === (item.id as TeamSubtab)
                    ? "2px solid var(--vscode-foreground)"
                    : "2px solid transparent",
              }}
              onClick={() => {
                setActiveSubtab(item.id as TeamSubtab)
                setRoleView("list")
                setEditingRole("")
              }}
            >
              {language.t(item.key)}
            </button>
          )}
        </For>
      </div>

      <Show when={activeSubtab() === "roles"}>
        <Show when={roleView() === "create"}>
          <TeamRoleEditor team={team()} onBack={() => setRoleView("list")} />
        </Show>
        <Show when={roleView() === "edit"}>
          <TeamRoleEditor team={team()} roleID={editingRole()} onBack={() => setRoleView("list")} />
        </Show>
        <Show when={roleView() === "list"}>
          <div
            style={{
              display: "flex",
              "justify-content": "space-between",
              "align-items": "center",
              "margin-bottom": "8px",
            }}
          >
            <div style={{ "font-size": "12px", color: "var(--text-weak-base)" }}>
              {language.t("settings.team.roles.description")}
            </div>
            <Button variant="secondary" size="small" onClick={() => setRoleView("create")}>
              {language.t("settings.team.roles.add")}
            </Button>
          </div>
          <Show
            when={roleEntries().length > 0}
            fallback={
              <Card>
                <div style={{ "font-size": "12px", color: "var(--text-weak-base)" }}>
                  {language.t("settings.team.roles.empty")}
                </div>
              </Card>
            }
          >
            <Card style={{ "margin-bottom": "10px" }}>
              <For each={roleEntries()}>
                {([roleID, role], index) => (
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      "justify-content": "space-between",
                      padding: "8px 0",
                      "border-bottom":
                        index() < roleEntries().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                    }}
                  >
                    <div>
                      <div style={{ "font-size": "13px", "font-weight": "600" }}>{role.displayName}</div>
                      <div style={{ "font-size": "11px", color: "var(--text-weak-base)" }}>
                        {roleID} · {role.provider}/{role.model} · T{role.tier} · {role.effort}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <IconButton
                        size="small"
                        variant="ghost"
                        icon="pencil-line"
                        onClick={() => {
                          setEditingRole(roleID)
                          setRoleView("edit")
                        }}
                      />
                      <IconButton size="small" variant="ghost" icon="close" onClick={() => deleteRole(roleID)} />
                    </div>
                  </div>
                )}
              </For>
            </Card>
            <TeamDelegationGraph team={team()} />
          </Show>
        </Show>
      </Show>

      <Show when={activeSubtab() === "routing"}>
        <TeamRoutingPanel
          team={team()}
          onChange={(routing) => {
            saveTeam({
              ...team(),
              routing,
            })
          }}
        />
      </Show>

      <Show when={activeSubtab() === "templates"}>
        <TeamTemplateGallery
          onApply={(template) => {
            saveTeam(template)
            setActiveSubtab("roles")
          }}
        />
      </Show>
    </div>
  )
}

export default TeamTab
