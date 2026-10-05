import { useSync } from "@tui/context/sync"
import { SettingsSelect } from "./models"
import type { Scope, SettingsState } from "./state"

export function AgentView(props: {
  ctx: SettingsState
  scope: Scope
  back: () => void
}) {
  const sync = useSync()
  const options = () => [
    {
      title: props.scope === "project" ? "Use inherited agent" : "Use default agent",
      description:
        props.scope === "project"
          ? "Remove the project override and use the global setting."
          : "Remove the global override and let Kilo pick the agent.",
      category: "Default",
      value: "",
    },
    ...sync.data.agent
      .filter((agent) => !agent.hidden && agent.mode !== "subagent")
      .map((agent) => ({
        title: agent.displayName ?? agent.name,
        description: agent.description ?? agent.name,
        category: "Agents",
        value: agent.name,
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  ]

  return (
    <SettingsSelect
      title="Choose default agent"
      options={options()}
      scrollbar={true}
      current={readString(props.ctx.field("default_agent", props.scope))}
      busy={props.ctx.store.busy}
      back={props.back}
      onSelect={async (option) => {
        const ok = option.value
          ? await props.ctx.updateField(props.scope, "default_agent", option.value, "Default agent")
          : await props.ctx.unsetField(props.scope, "default_agent", "Default agent")
        if (ok) props.back()
      }}
    />
  )
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined
}
