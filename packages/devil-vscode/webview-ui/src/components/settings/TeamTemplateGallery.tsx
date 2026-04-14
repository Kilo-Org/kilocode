import { Component, createSignal, For, onMount } from "solid-js"
import { Button } from "@devilcode/kilo-ui/button"
import { Card } from "@devilcode/kilo-ui/card"
import type { TeamConfig, TeamRoleConfig } from "../../types/messages"
import { useLanguage } from "../../context/language"

interface TeamPreset {
  id: string
  name: string
  description: string
  team: TeamConfig
}

interface TeamTemplateGalleryProps {
  onApply: (team: TeamConfig) => void
}

const defaultRole = (displayName: string, provider: string, model: string, tier: number): TeamRoleConfig => ({
  displayName,
  provider,
  model,
  effort: tier === 1 ? "high" : "medium",
  tier,
  canDelegate: [],
  maxConcurrent: 3,
  capabilities: [],
})

const fallbackPresets: TeamPreset[] = [
  {
    id: "solo-enhanced",
    name: "Solo Enhanced",
    description: "Single lead agent with a fast research helper.",
    team: {
      enabled: true,
      roles: {
        lead: { ...defaultRole("Lead Engineer", "kilo", "gpt-5", 1), canDelegate: ["research"] },
        research: { ...defaultRole("Research Scout", "kilo", "gpt-5-mini", 2) },
      },
      routing: { strategy: "hierarchical", defaultRole: "lead", escalationEnabled: true },
      reactions: [],
    },
  },
  {
    id: "code-review-pair",
    name: "Code Review Pair",
    description: "Primary coder with a reviewer subagent.",
    team: {
      enabled: true,
      roles: {
        coder: { ...defaultRole("Coder", "kilo", "gpt-5", 1), canDelegate: ["reviewer"] },
        reviewer: { ...defaultRole("Reviewer", "kilo", "claude-4.1-sonnet", 2) },
      },
      routing: { strategy: "hierarchical", defaultRole: "coder", escalationEnabled: true },
      reactions: [],
    },
  },
]

const TeamTemplateGallery: Component<TeamTemplateGalleryProps> = (props) => {
  const language = useLanguage()
  const [presets, setPresets] = createSignal<TeamPreset[]>(fallbackPresets)

  onMount(async () => {
    try {
      const response = await fetch("/config/team/presets")
      if (!response.ok) return
      const data = (await response.json()) as TeamPreset[]
      if (Array.isArray(data) && data.length > 0) setPresets(data)
    } catch {
      // Keep fallback presets when route is unavailable in the webview host.
    }
  })

  return (
    <div style={{ display: "grid", gap: "12px", "grid-template-columns": "repeat(auto-fit, minmax(220px, 1fr))" }}>
      <For each={presets()}>
        {(preset) => (
          <Card>
            <div style={{ "font-size": "13px", "font-weight": "600", "margin-bottom": "4px" }}>{preset.name}</div>
            <div style={{ "font-size": "12px", color: "var(--text-weak-base)", "margin-bottom": "8px" }}>
              {preset.description}
            </div>
            <div style={{ "font-size": "11px", color: "var(--text-weak-base)", "margin-bottom": "10px" }}>
              {Object.keys(preset.team.roles).length} roles
            </div>
            <Button variant="secondary" size="small" onClick={() => props.onApply(preset.team)}>
              {language.t("settings.team.templates.use")}
            </Button>
          </Card>
        )}
      </For>
    </div>
  )
}

export default TeamTemplateGallery
