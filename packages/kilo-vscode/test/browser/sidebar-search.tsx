/** @jsxImportSource solid-js */
import "@kilocode/kilo-ui/styles"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { createSignal, onCleanup, onMount } from "solid-js"
import { render } from "solid-js/web"
import { SidebarSearchMenu } from "../../webview-ui/agent-manager/SidebarSearchMenu"
import type { SidebarSearchItem } from "../../webview-ui/agent-manager/sidebar-search"
import "../../webview-ui/agent-manager/agent-manager.css"
import "../../webview-ui/src/styles/search-menu.css"

// The browser fixture has no VS Code host to inject these Dark Modern theme values.
for (const [token, value] of Object.entries({
  "editor-background": "#1f1f1f",
  "editor-foreground": "#ccc",
  foreground: "#ccc",
  descriptionForeground: "#9d9d9d",
  disabledForeground: "rgba(204, 204, 204, 0.5)",
  "icon-foreground": "#ccc",
  focusBorder: "#0078d4",
  "editorWidget-background": "#202020",
  "sideBar-background": "#181818",
  "input-background": "#313131",
})) {
  document.documentElement.style.setProperty(`--vscode-${token}`, value)
}

const items: SidebarSearchItem[] = [
  {
    kind: "local",
    key: "local",
    group: "contexts",
    title: "Local workspace",
    meta: ["main"],
    search: "main",
    state: "idle",
    count: 1,
    visible: true,
    updatedAt: "",
  },
  {
    kind: "session",
    key: "session:render",
    group: "sessions",
    location: "local",
    sessionId: "render",
    title: "Render images in diff viewer",
    meta: ["Local workspace"],
    search: "Local workspace",
    state: "idle",
    visible: true,
    updatedAt: "",
  },
]

function Sidebar() {
  const [selection, setSelection] = createSignal<SidebarSearchItem>()
  const prompt = document.createElement("textarea")
  prompt.setAttribute("aria-label", "Chat input")

  // The real composer consumes this event. Here the textarea tests the menu's focus handoff in isolation.
  const focusPrompt = (event: Event) => {
    if (event instanceof CustomEvent && event.detail?.restore === true) prompt.focus()
  }
  onMount(() => window.addEventListener("focusPrompt", focusPrompt))
  onCleanup(() => window.removeEventListener("focusPrompt", focusPrompt))

  return (
    <main class="am-layout">
      <aside class="am-sidebar">
        <SidebarSearchMenu
          items={() => items}
          current={selection}
          keybind="Ctrl+F"
          labels={{
            search: "Search worktrees and sessions",
            scope: "Search the local workspace, worktrees and sessions",
            contexts: "Local & worktrees",
            sessions: "Sessions",
            state: (value) => value,
          }}
          portal
          onSelect={setSelection}
        />
      </aside>
      <div>
        {prompt}
        <output data-testid="selection">{selection()?.title}</output>
      </div>
    </main>
  )
}

render(
  () => (
    <ThemeProvider defaultTheme="kilo-vscode">
      <Sidebar />
    </ThemeProvider>
  ),
  document.body,
)
