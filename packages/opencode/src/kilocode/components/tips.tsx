// kilocode_change - new file

import { For } from "solid-js"
import { DEFAULT_THEMES, useTheme } from "@tui/context/theme"

const themeCount = Object.keys(DEFAULT_THEMES).length
const themeTip = `Use {highlight}/theme{/highlight} or {highlight}Ctrl+X T{/highlight} to switch between ${themeCount} built-in themes`

type TipPart = { text: string; highlight: boolean }

function parse(tip: string): TipPart[] {
  const parts: TipPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  const found = Array.from(tip.matchAll(regex))
  const state = found.reduce(
    (acc, match) => {
      const start = match.index ?? 0
      if (start > acc.index) {
        acc.parts.push({ text: tip.slice(acc.index, start), highlight: false })
      }
      acc.parts.push({ text: match[1], highlight: true })
      acc.index = start + match[0].length
      return acc
    },
    { parts, index: 0 },
  )

  if (state.index < tip.length) {
    parts.push({ text: tip.slice(state.index), highlight: false })
  }

  return parts
}

export function Tips() {
  const theme = useTheme().theme
  const parts = parse(TIPS[Math.floor(Math.random() * TIPS.length)])

  return (
    <box flexDirection="row" maxWidth="100%">
      <text flexShrink={0} style={{ fg: theme.warning }}>
        ● Tip{" "}
      </text>
      <text flexShrink={1}>
        <For each={parts}>
          {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
        </For>
      </text>
    </box>
  )
}

// Curated tips for Kilo CLI
const TIPS = [
  "Type {highlight}@{/highlight} followed by a filename to fuzzy search and attach files",
  "Start a message with {highlight}!{/highlight} to run shell commands directly (e.g., {highlight}!ls -la{/highlight})",
  "Press {highlight}Tab{/highlight} to cycle between Build and Plan agents",
  "Use {highlight}/undo{/highlight} to revert the last message and file changes",
  "Use {highlight}/redo{/highlight} to restore previously undone messages and file changes",
  "Drag and drop images into the terminal to add them as context",
  "Press {highlight}Ctrl+V{/highlight} to paste images from your clipboard into the prompt",
  "Press {highlight}Ctrl+X E{/highlight} or {highlight}/editor{/highlight} to compose messages in your external editor",
  "Run {highlight}/init{/highlight} to auto-generate project rules based on your codebase",
  "Run {highlight}/models{/highlight} or {highlight}Ctrl+X M{/highlight} to see and switch between available AI models",
  themeTip,
  "Press {highlight}Ctrl+X N{/highlight} or {highlight}/new{/highlight} to start a fresh conversation session",
  "Use {highlight}/sessions{/highlight} or {highlight}Ctrl+X L{/highlight} to list and continue previous conversations",
  "Run {highlight}/compact{/highlight} to summarize long sessions near context limits",
  "Press {highlight}Ctrl+X X{/highlight} or {highlight}/export{/highlight} to save the conversation as Markdown",
  "Press {highlight}Ctrl+X Y{/highlight} to copy the assistant's last message to clipboard",
  "Press {highlight}Ctrl+P{/highlight} to see all available actions and commands",
  "Run {highlight}/connect{/highlight} to add API keys for 75+ supported LLM providers",
  "The leader key is {highlight}Ctrl+X{/highlight}; combine with other keys for quick actions",
  "Press {highlight}F2{/highlight} to quickly switch between recently used models",
  "Press {highlight}Ctrl+X B{/highlight} to show/hide the sidebar panel",
  "Use {highlight}PageUp{/highlight}/{highlight}PageDown{/highlight} to navigate through conversation history",
  "Press {highlight}Ctrl+G{/highlight} or {highlight}Home{/highlight} to jump to the beginning of the conversation",
  "Press {highlight}Ctrl+Alt+G{/highlight} or {highlight}End{/highlight} to jump to the most recent message",
  "Press {highlight}Shift+Enter{/highlight} or {highlight}Ctrl+J{/highlight} to add newlines in your prompt",
  "Press {highlight}Ctrl+C{/highlight} when typing to clear the input field",
  "Press {highlight}Escape{/highlight} to stop the AI mid-response",
  "Switch to {highlight}Plan{/highlight} agent to get suggestions without making actual changes",
  "Use {highlight}@agent-name{/highlight} in prompts to invoke specialized subagents",
  "Press {highlight}Ctrl+X Right/Left{/highlight} to cycle through parent and child sessions",
  "Kilo auto-formats files using prettier, gofmt, ruff, and more",
  "Kilo uses LSP servers for intelligent code analysis",
  "Use {highlight}kilo run{/highlight} for non-interactive scripting",
  "Use {highlight}kilo --continue{/highlight} to resume the last session",
  "Use {highlight}kilo run -f file.ts{/highlight} to attach files via CLI",
  "Use {highlight}--format json{/highlight} for machine-readable output in scripts",
  "Run {highlight}kilo serve{/highlight} for headless API access to Kilo",
  "Use {highlight}kilo run --attach{/highlight} to connect to a running server",
  "Run {highlight}kilo upgrade{/highlight} to update to the latest version",
  "Run {highlight}kilo auth list{/highlight} to see all configured providers",
  'Use {highlight}"theme": "system"{/highlight} to match your terminal\'s colors',
  "Reference ANSI colors 0-255 in custom themes",
  "Set agent {highlight}temperature{/highlight} from 0.0 (focused) to 1.0 (creative)",
  "Configure {highlight}maxSteps{/highlight} to limit agentic iterations per request",
  "Press {highlight}Ctrl+X G{/highlight} or {highlight}/timeline{/highlight} to jump to specific messages",
  "Press {highlight}Ctrl+X S{/highlight} or {highlight}/status{/highlight} to see system status info",
  "Enable {highlight}tui.scroll_acceleration{/highlight} for smooth macOS-style scrolling",
  "Toggle username display in chat via command palette ({highlight}Ctrl+P{/highlight})",
  "Commit your project's {highlight}AGENTS.md{/highlight} file to Git for team sharing",
  "Use {highlight}/review{/highlight} to review uncommitted changes, branches, or PRs",
  "Run {highlight}/help{/highlight} to show the help dialog",
  "Use {highlight}/details{/highlight} to toggle tool execution details visibility",
  "Use {highlight}/rename{/highlight} to rename the current session",
  "Press {highlight}Ctrl+Z{/highlight} to suspend the terminal and return to your shell",
]
