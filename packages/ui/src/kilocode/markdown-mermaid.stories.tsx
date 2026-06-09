// @ts-nocheck
import { Markdown } from "../components/markdown"

const text = `Diagram:

\`\`\`mermaid
flowchart TD
  A[Prompt] --> B{Needs tools?}
  B -->|Yes| C[Run tool]
  B -->|No| D[Respond]
  C --> D
\`\`\`
`

export default {
  title: "Kilo/Markdown Mermaid",
  id: "kilocode-markdown-mermaid",
}

export const Mermaid = {
  render: () => <Markdown text={text} />,
}

export const MermaidError = {
  render: () => (
    <Markdown
      text={`Broken diagram:

\`\`\`mermaid
flowchart TD
  A -->
\`\`\`
`}
    />
  ),
}

export const MermaidThemes = {
  render: () => (
    <div style={{ display: "grid", gap: "24px" }}>
      <div
        style={{
          padding: "16px",
          color: "#1f2328",
          "background-color": "#ffffff",
          "--vscode-editor-background": "#ffffff",
          "--vscode-editor-foreground": "#1f2328",
          "--vscode-editorWidget-background": "#f6f8fa",
          "--vscode-editorWidget-border": "#d0d7de",
          "--vscode-descriptionForeground": "#57606a",
          "--vscode-textLink-foreground": "#0969da",
        }}
      >
        <Markdown text={text} />
      </div>
      <div
        style={{
          padding: "16px",
          color: "#d4d4d4",
          "background-color": "#1e1e1e",
          "--vscode-editor-background": "#1e1e1e",
          "--vscode-editor-foreground": "#d4d4d4",
          "--vscode-editorWidget-background": "#252526",
          "--vscode-editorWidget-border": "#454545",
          "--vscode-descriptionForeground": "#cccccc",
          "--vscode-textLink-foreground": "#3794ff",
        }}
      >
        <Markdown text={text} />
      </div>
    </div>
  ),
}
