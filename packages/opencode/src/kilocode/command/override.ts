// kilocode_change - new file
type Existing = {
  name: string
  description?: string
  agent?: string
  model?: string
  variant?: string
  source?: "command" | "mcp" | "skill"
  trusted?: boolean
  template: string | Promise<string>
  subtask?: boolean
  hints: readonly string[]
}

export type Override = {
  template?: string
  description?: string
  agent?: string
  model?: string
  variant?: string
  subtask?: boolean
}

type Hints = (template: string) => string[]

export function apply(commands: Record<string, Existing>, name: string, command: Override, hints: Hints) {
  const existing = commands[name]
  if (command.template === undefined) {
    if (!existing) return false
    if (command.description !== undefined) existing.description = command.description
    if (command.agent !== undefined) existing.agent = command.agent
    if (command.model !== undefined) existing.model = command.model
    if (command.variant !== undefined) existing.variant = command.variant
    if (command.subtask !== undefined) existing.subtask = command.subtask
    return true
  }

  const template = command.template
  commands[name] = {
    name,
    agent: command.agent,
    model: command.model,
    variant: command.variant,
    description: command.description,
    source: "command",
    get template() {
      return template
    },
    subtask: command.subtask,
    hints: hints(template),
  }
  return true
}
