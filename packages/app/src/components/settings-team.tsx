import { Button } from "@opencode-ai/ui/button"
import { Card } from "@opencode-ai/ui/card"
import { Switch } from "@opencode-ai/ui/switch"
import { type Component, For, Show, createSignal, onMount } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"

type TeamEffortLevel = "max" | "xhigh" | "high" | "medium" | "low" | "default"
type TeamRole = {
  displayName: string
  provider: string
  model: string
  effort: TeamEffortLevel
  tier: number
  canDelegate: string[]
  maxConcurrent: number
  capabilities: string[]
}

type TeamConfig = {
  enabled: boolean
  roles: Record<string, TeamRole>
  routing: {
    strategy: "hierarchical" | "flat"
    defaultRole: string
    escalationEnabled: boolean
  }
}

// devilcode_change start - audit MA6: hardcoded presets are now a fallback only.
// Real source of truth is the server's `/config/team/presets` endpoint.
type PresetEntry = { id: string; name: string; description: string; team: TeamConfig }

const fallbackPresets: PresetEntry[] = [
  {
    id: "solo",
    name: "Solo Enhanced",
    description: "Single lead role with a helper role.",
    team: {
      enabled: true,
      roles: {
        lead: {
          displayName: "Lead Engineer",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 1,
          canDelegate: ["research"],
          maxConcurrent: 3,
          capabilities: ["implementation"],
        },
        research: {
          displayName: "Research Scout",
          provider: "kilo",
          model: "gpt-5-mini",
          effort: "low",
          tier: 2,
          canDelegate: [],
          maxConcurrent: 4,
          capabilities: ["search"],
        },
      },
      routing: {
        strategy: "hierarchical",
        defaultRole: "lead",
        escalationEnabled: true,
      },
    },
  },
  {
    id: "fullstack",
    name: "Full Stack Team",
    description: "Architect delegating to frontend/backend and reviewer.",
    team: {
      enabled: true,
      roles: {
        architect: {
          displayName: "Architect",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 1,
          canDelegate: ["frontend-dev", "backend-dev", "reviewer"],
          maxConcurrent: 4,
          capabilities: ["architecture"],
        },
        "frontend-dev": {
          displayName: "Frontend Developer",
          provider: "kilo",
          model: "claude-4.1-sonnet",
          effort: "medium",
          tier: 2,
          canDelegate: [],
          maxConcurrent: 3,
          capabilities: ["ui"],
        },
        "backend-dev": {
          displayName: "Backend Developer",
          provider: "kilo",
          model: "gpt-5-mini",
          effort: "medium",
          tier: 2,
          canDelegate: [],
          maxConcurrent: 3,
          capabilities: ["api"],
        },
        reviewer: {
          displayName: "Reviewer",
          provider: "kilo",
          model: "gpt-5-mini",
          effort: "low",
          tier: 2,
          canDelegate: [],
          maxConcurrent: 2,
          capabilities: ["review"],
        },
      },
      routing: {
        strategy: "hierarchical",
        defaultRole: "architect",
        escalationEnabled: true,
      },
    },
  },
]

// devilcode_change end

export const SettingsTeam: Component = () => {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  // devilcode_change start - audit MA6: server-first preset fetch with hardcoded fallback.
  const [presets, setPresets] = createSignal<PresetEntry[]>(fallbackPresets)
  onMount(async () => {
    try {
      const response = await fetch("/config/team/presets")
      if (!response.ok) {
        console.warn("team preset fetch failed", { status: response.status })
        return
      }
      const data = (await response.json()) as PresetEntry[]
      if (Array.isArray(data) && data.length > 0) setPresets(data)
    } catch (err) {
      console.warn("team preset fetch failed", err)
    }
  })
  // devilcode_change end

  const current = () => (globalSync.data.config as any).team as TeamConfig | undefined
  const team = () =>
    current() ?? {
      enabled: false,
      roles: {},
      routing: { strategy: "hierarchical" as const, defaultRole: "", escalationEnabled: true },
    }

  const setTeam = (next: TeamConfig) => {
    globalSync.set("config", ((prev: any) => ({ ...prev, team: next })) as any)
    void globalSync.updateConfig({ team: next } as any)
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-6 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.team.title")}</h2>
          <span class="text-12-regular text-text-weak">{language.t("settings.team.description")}</span>
        </div>
      </div>

      <div class="flex flex-col gap-6 max-w-[720px]">
        <Card>
          <div class="flex items-center justify-between gap-4 p-4">
            <div>
              <div class="text-14-medium text-text-strong">{language.t("settings.team.enabled")}</div>
              <div class="text-12-regular text-text-weak">{language.t("settings.team.enabled.description")}</div>
            </div>
            <Switch checked={team().enabled} onChange={(checked) => setTeam({ ...team(), enabled: checked })} hideLabel>
              {language.t("settings.team.enabled")}
            </Switch>
          </div>
        </Card>

        <Card>
          <div class="p-4 border-b border-border-weak-base">
            <div class="text-14-medium text-text-strong">{language.t("settings.team.templates.title")}</div>
            <div class="text-12-regular text-text-weak">{language.t("settings.team.templates.description")}</div>
          </div>
          <div class="p-4 flex flex-col gap-4">
            <For each={presets()}>
              {(preset) => (
                <div class="flex items-center justify-between gap-4">
                  <div>
                    <div class="text-14-medium text-text-strong">{preset.name}</div>
                    <div class="text-12-regular text-text-weak">{preset.description}</div>
                  </div>
                  <Button variant="secondary" size="small" onClick={() => setTeam(preset.team)}>
                    {language.t("settings.team.templates.use")}
                  </Button>
                </div>
              )}
            </For>
          </div>
        </Card>

        <Card>
          <div class="p-4 border-b border-border-weak-base">
            <div class="text-14-medium text-text-strong">{language.t("settings.team.subtab.roles")}</div>
          </div>
          <Show
            when={Object.entries(team().roles).length > 0}
            fallback={<div class="p-4 text-12-regular text-text-weak">{language.t("settings.team.roles.empty")}</div>}
          >
            <div class="p-4 flex flex-col gap-3">
              <For each={Object.entries(team().roles)}>
                {([roleID, role]) => (
                  <div class="flex flex-col gap-1 pb-3 border-b border-border-weak-base last:border-none">
                    <div class="text-14-medium text-text-strong">
                      {role.displayName} <span class="text-text-weak">({roleID})</span>
                    </div>
                    <div class="text-12-regular text-text-weak">
                      {role.provider}/{role.model} · T{role.tier} · {role.effort}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Card>
      </div>
    </div>
  )
}
