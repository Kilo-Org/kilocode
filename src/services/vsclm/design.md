# Roo Tool Selection Feature Design

## Goal

Provide a dedicated tool selection interface in the Roo sidebar that allows users to:

- View and manage all available tools from any extension (discovered via `vscode.extensions.all` and `vscode.lm.tools`)
- Select/deselect tools for AI agent use through a persistent TreeView interface
- Group tools by extension with hierarchical selection controls
- Present the selected tools to the AI agent for awareness (so the agent knows which tools are available)
- Per agent request, invoke selected tools via the native `vscode.lm` API

## Implementation Plan

### 1. Tool Discovery

- Enumerate all available tools by scanning each installed extension's `packageJSON` at runtime and reading its `contributes.languageModelTools` section. This provides tool metadata (name, description, inputSchema, tags, icon, displayName, etc.) for UI and selection.
- When invoking a tool, use the runtime tool object from `vscode.lm.tools` (type: `LanguageModelToolInformation[]`). Only tools present in both the metadata and `vscode.lm.tools` are considered available for invocation and agent awareness.

### 2. UI Integration

- Add a persistent TreeView to the Roo sidebar panel using VS Code's native TreeView API.
- Register the view in package.json under the `roo-cline-ActivityBar` container.
- Position the TreeView at the bottom of the Roo panel for easy access.
- Implement hierarchical tool organization with extension-level groups.
- Use checkbox states to show and control tool selection.
- Show selection counts in group headers (e.g., "Extension Name (3/5)").

### 3. Tool Selection Handling

- Persist selected tool names in a YAML file at `.roo/tools/selection.yaml`
- Bidirectional selection logic is automatically handled by VSCode's TreeView implementation
- Only expose selected tools to the chat agent
- Update selection state immediately when checkboxes are toggled

### 4. Tool Invocation

- When a tool is invoked via chat, use the native `vscode.lm.invokeTool(toolName, { input }, token)` API.
- Present tool results in chat.

## Implementation Details

### TreeView Implementation

- Use VS Code's native TreeView component for tool selection interface
- Implement VSCLMToolsService class to manage tool data and state
- Use proper VS Code icons: `$(extensions)` for groups, `$(tools)` for individual tools
- Show selection count in TreeView title (e.g., "Tool Selection (3/10)")
- Store selections in YAML file at `.roo/tools/selection.yaml`
- Bidirectional selection is automatically handled by TreeView

## Notes

- **File-based persistence** - YAML storage provides better version control and visibility
- **VSCode TreeView benefits** - handles bidirectional selection automatically
- **Visual hierarchy** - extension groups provide clear organization
- **Approval mode** - simple toggle implementation provides effective control
- **Minimal implementation** - focuses on core functionality while maintaining extensibility
