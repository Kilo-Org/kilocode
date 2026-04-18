import { Component, createMemo, createSignal } from "solid-js"
import { Button } from "@devilcode/kilo-ui/button"
import { Card } from "@devilcode/kilo-ui/card"
import { Select } from "@devilcode/kilo-ui/select"
import { TextField } from "@devilcode/kilo-ui/text-field"
import type { TeamConfig, TeamEffortLevel, TeamRoleConfig } from "../../types/messages"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import SettingsRow from "./SettingsRow"

interface TeamRoleEditorProps {
  team: TeamConfig
  roleID?: string
  onBack: () => void
}

const ROLE_ID_REGEX = /^[a-z][a-z0-9-]*$/
const BUILTIN_AGENT_NAMES = new Set([
  "code",
  "plan",
  "debug",
  "orchestrator",
  "ask",
  "general",
  "explore",
  "title",
  "summary",
  "compaction",
])

const effortOptions: { value: TeamEffortLevel; labelKey: string }[] = [
  { value: "default", labelKey: "settings.team.role.effort.default" },
  { value: "low", labelKey: "settings.team.role.effort.low" },
  { value: "medium", labelKey: "settings.team.role.effort.medium" },
  { value: "high", labelKey: "settings.team.role.effort.high" },
  { value: "xhigh", labelKey: "settings.team.role.effort.xhigh" },
  { value: "max", labelKey: "settings.team.role.effort.max" },
]

const TeamRoleEditor: Component<TeamRoleEditorProps> = (props) => {
  const language = useLanguage()
  const { config, updateConfig } = useConfig()
  const existing = () => (props.roleID ? props.team.roles[props.roleID] : undefined)

  const [roleID, setRoleID] = createSignal(props.roleID || "")
  const [displayName, setDisplayName] = createSignal(existing()?.displayName || "")
  const [provider, setProvider] = createSignal(existing()?.provider || "kilo")
  const [model, setModel] = createSignal(existing()?.model || "")
  const [tier, setTier] = createSignal(existing()?.tier || 2)
  const [effort, setEffort] = createSignal<TeamEffortLevel>(existing()?.effort || "default")
  const [canDelegate, setCanDelegate] = createSignal(existing()?.canDelegate.join(", ") || "")
  const [maxConcurrent, setMaxConcurrent] = createSignal(String(existing()?.maxConcurrent ?? 3))
  const [capabilities, setCapabilities] = createSignal(existing()?.capabilities.join(", ") || "")
  const [error, setError] = createSignal("")

  const providerOptions = createMemo(() =>
    Object.keys(config().provider ?? {}).map((key) => ({
      value: key,
      label: key,
    })),
  )

  const modelOptions = createMemo(() => {
    const selectedProvider = provider()
    const p = config().provider?.[selectedProvider]
    const ids = Object.keys((p?.models as Record<string, unknown> | undefined) ?? {})
    return ids.map((id) => ({ value: id, label: id }))
  })

  const validate = () => {
    const trimmedID = roleID().trim()
    if (!trimmedID) return language.t("settings.team.validation.roleIdRequired")
    if (!ROLE_ID_REGEX.test(trimmedID)) return language.t("settings.team.validation.roleIdInvalid")
    if (BUILTIN_AGENT_NAMES.has(trimmedID)) return language.t("settings.team.validation.roleIdConflict")
    if (!props.roleID && props.team.roles[trimmedID]) return language.t("settings.team.validation.roleIdTaken")
    if (!displayName().trim()) return language.t("settings.team.validation.displayNameRequired")
    if (!provider().trim()) return language.t("settings.team.validation.providerRequired")
    if (!model().trim()) return language.t("settings.team.validation.modelRequired")
    return ""
  }

  const save = () => {
    const message = validate()
    if (message) {
      setError(message)
      return
    }

    const normalizedID = roleID().trim()
    const role: TeamRoleConfig = {
      displayName: displayName().trim(),
      provider: provider().trim(),
      model: model().trim(),
      effort: effort(),
      tier: Number(tier()) || 2,
      canDelegate: canDelegate()
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      maxConcurrent: Math.max(1, Number(maxConcurrent()) || 1),
      capabilities: capabilities()
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    }

    const roles = { ...(props.team.roles ?? {}) }
    if (props.roleID && props.roleID !== normalizedID) {
      delete roles[props.roleID]
    }
    roles[normalizedID] = role

    const nextTeam: TeamConfig = {
      ...props.team,
      enabled: props.team.enabled,
      roles,
      routing: {
        ...props.team.routing,
        defaultRole:
          props.team.routing.defaultRole && roles[props.team.routing.defaultRole]
            ? props.team.routing.defaultRole
            : normalizedID,
      },
    }

    updateConfig({ team: nextTeam })
    props.onBack()
  }

  return (
    <Card>
      <SettingsRow title={language.t("settings.team.role.id")} last={false}>
        <TextField
          value={roleID()}
          disabled={Boolean(props.roleID)}
          placeholder={language.t("settings.team.role.id.placeholder")}
          onChange={setRoleID}
        />
      </SettingsRow>

      <SettingsRow title={language.t("settings.team.role.displayName")} last={false}>
        <TextField
          value={displayName()}
          placeholder={language.t("settings.team.role.displayName.placeholder")}
          onChange={setDisplayName}
        />
      </SettingsRow>

      <SettingsRow title={language.t("settings.team.role.provider")} last={false}>
        <Select
          options={providerOptions()}
          current={providerOptions().find((opt) => opt.value === provider())}
          value={(opt) => opt.value}
          label={(opt) => opt.label}
          onSelect={(opt) => setProvider(opt?.value || "")}
          variant="secondary"
          size="small"
          triggerVariant="settings"
        />
      </SettingsRow>

      <SettingsRow title={language.t("settings.team.role.model")} last={false}>
        <Select
          options={modelOptions()}
          current={modelOptions().find((opt) => opt.value === model())}
          value={(opt) => opt.value}
          label={(opt) => opt.label}
          onSelect={(opt) => setModel(opt?.value || "")}
          variant="secondary"
          size="small"
          triggerVariant="settings"
        />
      </SettingsRow>

      <SettingsRow title={language.t("settings.team.role.tier")} last={false}>
        <Select
          options={[
            { value: "1", label: language.t("settings.team.role.tier.primary") },
            { value: "2", label: language.t("settings.team.role.tier.subagent") },
          ]}
          current={{ value: String(tier()), label: String(tier()) }}
          value={(opt) => opt.value}
          label={(opt) => opt.label}
          onSelect={(opt) => setTier(Number(opt?.value || 2))}
          variant="secondary"
          size="small"
          triggerVariant="settings"
        />
      </SettingsRow>

      <SettingsRow title={language.t("settings.team.role.effort")} last={false}>
        <Select
          options={effortOptions.map((opt) => ({ value: opt.value, label: language.t(opt.labelKey) }))}
          current={{ value: effort(), label: effort() }}
          value={(opt) => opt.value}
          label={(opt) => opt.label}
          onSelect={(opt) => setEffort((opt?.value as TeamEffortLevel) || "default")}
          variant="secondary"
          size="small"
          triggerVariant="settings"
        />
      </SettingsRow>

      <SettingsRow title={language.t("settings.team.role.canDelegate")} last={false}>
        <TextField value={canDelegate()} placeholder="frontend-dev, backend-dev" onChange={setCanDelegate} />
      </SettingsRow>

      <SettingsRow title={language.t("settings.team.role.maxConcurrent")} last={false}>
        <TextField value={maxConcurrent()} onChange={setMaxConcurrent} />
      </SettingsRow>

      <SettingsRow title={language.t("settings.team.role.capabilities")} last>
        <TextField value={capabilities()} placeholder="review, tests, planning" onChange={setCapabilities} />
      </SettingsRow>

      {error() ? (
        <div style={{ "font-size": "12px", color: "var(--vscode-errorForeground)", "margin-top": "8px" }}>
          {error()}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end", "margin-top": "12px" }}>
        <Button variant="ghost" size="small" onClick={props.onBack}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="secondary" size="small" onClick={save}>
          {language.t("common.save")}
        </Button>
      </div>
    </Card>
  )
}

export default TeamRoleEditor
