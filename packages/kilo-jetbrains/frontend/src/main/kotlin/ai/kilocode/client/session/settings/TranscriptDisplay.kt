package ai.kilocode.client.session.settings

/**
 * How reasoning blocks start in the transcript. Mirrors VS Code's `reasoning_display` config
 * values (`packages/kilo-vscode/webview-ui/src/types/messages/config.ts`), stored here as an
 * IDE-local preference instead of CLI config.
 */
enum class ReasoningDisplay(val storageKey: String) {
    EXPANDED("expanded"),
    PREVIEW("preview"),
    HEADLINE("headline"),
}

/**
 * Expanded-vs-collapsed default for a transcript block kind (terminal commands, code edits, MCP
 * and generic tool calls). Mirrors VS Code's `terminal_command_display` / `code_edit_display` /
 * `mcp_tool_display` config values.
 */
enum class BlockDisplay(val storageKey: String) {
    EXPANDED("expanded"),
    COLLAPSED("collapsed"),
}
