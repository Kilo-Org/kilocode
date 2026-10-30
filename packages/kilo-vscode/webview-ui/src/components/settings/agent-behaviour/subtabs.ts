// The Agent Behaviour subtabs in rail order. `ready` marks the subtabs with a finished v2 contract; the tab renders
// only ready subtabs. The `ready` line is on its own so a later change that flips one subtab does not touch the others.
import { lazy, type Component } from "solid-js"

export interface AgentBehaviourSubtabProps {
  navigation?: number
}

export interface AgentBehaviourSubtab {
  id: string
  title: string
  ready: boolean
  component: Component<AgentBehaviourSubtabProps>
}

export const AGENT_BEHAVIOUR_SUBTABS: AgentBehaviourSubtab[] = [
  {
    id: "agents",
    title: "settings.agentBehaviour.subtab.agents",
    ready: true,
    component: lazy(() => import("./AgentsSubtab")),
  },
  {
    id: "mcpServers",
    title: "settings.agentBehaviour.subtab.mcpServers",
    ready: true,
    component: lazy(() => import("./McpSubtab")),
  },
  {
    id: "rules",
    title: "settings.agentBehaviour.subtab.rules",
    ready: true,
    component: lazy(() => import("./RulesSubtab")),
  },
  {
    id: "workflows",
    title: "settings.agentBehaviour.subtab.workflows",
    ready: true,
    component: lazy(() => import("./WorkflowsSubtab")),
  },
  {
    id: "skills",
    title: "settings.agentBehaviour.subtab.skills",
    ready: true,
    component: lazy(() => import("./SkillsSubtab")),
  },
]
