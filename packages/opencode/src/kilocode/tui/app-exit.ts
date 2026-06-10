export type Prompt = {
  readonly focused: boolean
  readonly current: { readonly input: string }
}

export function enabled(matcher: boolean, prompt?: Prompt) {
  if (!matcher) return false
  if (!prompt?.focused) return true
  return prompt.current.input === ""
}

export function command(exit: () => void) {
  return {
    name: "app.exit",
    title: "Exit the app",
    slashName: "exit",
    slashAliases: ["quit", "q"],
    run: exit,
    category: "System",
  }
}
