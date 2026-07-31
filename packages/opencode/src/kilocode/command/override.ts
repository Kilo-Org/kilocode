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

type Override = {
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
    if (!existing) return
    commands[name] = {
      ...existing,
      ...(command.description !== undefined ? { description: command.description } : {}),
      ...(command.agent !== undefined ? { agent: command.agent } : {}),
      ...(command.model !== undefined ? { model: command.model } : {}),
      ...(command.variant !== undefined ? { variant: command.variant } : {}),
      ...(command.subtask !== undefined ? { subtask: command.subtask } : {}),
    }
    return
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
}
