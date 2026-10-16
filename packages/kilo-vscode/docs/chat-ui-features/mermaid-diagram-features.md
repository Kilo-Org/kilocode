# Mermaid Diagrams

Chat Markdown renders fenced `mermaid` code blocks as diagrams after a response finishes streaming.

## Behavior

- Valid `mermaid` fences render inline as SVG diagrams.
- The original Mermaid source remains available through the existing code-block copy button.
- Rendered diagrams include Copy and Download menus for Mermaid source, SVG, and PNG formats.
- The Zoom action opens a fullscreen viewer with zoom in/out and reset controls, mouse-wheel zoom, drag-to-pan, and keyboard shortcuts (`+`, `-`, `0`, `Escape`).
- Invalid Mermaid syntax shows a contained error state and keeps the source visible.
- Diagrams are not rendered while a message is streaming, which avoids repeated parse/render work on every token.
- Diagram colors are derived from the active VS Code/Kilo CSS variables so light, dark, and high-contrast themes can render with matching backgrounds, text, borders, and link colors.

## Limitations

- Mermaid is bundled by the current webview build, so bundle splitting remains a future optimization.
- Advanced legacy actions are not restored yet: AI syntax fixing.
