---
title: Tool Use Details
description: Learn how Kilo Code's tools automate your development workflow
---

# Tool Use Overview

Kilo Code implements a sophisticated tool system that allows AI models to interact with your development environment in a controlled and secure manner. This document explains how tools work, when they're called, and how they're managed.

## Core Concepts

### Tool Groups

Tools are organized into logical groups based on their functionality:

| Category | Purpose | Tools | Common Use |
|---|---|---|---|
| **Read Group** | File system reading and searching | `read`, `glob`, `grep` | Code exploration and analysis |
| **Edit Group** | File system modifications | `edit`, `write`, `apply_patch` | Code changes and file manipulation |
| **Execute Group** | Shell command execution | `bash` | Running scripts, building projects |
| **Web Group** | Fetch and search web content | `webfetch`, `websearch` | Research, documentation lookup |
| **Browser Group** | Web browser automation | `kilo-playwright_*` (via built-in Playwright MCP) | Browser testing and interaction |
| **MCP Group** | External tool integration | MCP server tools (namespaced as `{server}_{tool}`) | Specialized functionality via MCP |
| **Workflow Group** | Sub-agents and task management | `question`, `task`, `todowrite`, `todoread`, `plan`, `skill`, `agent_manager` | Context switching and task organization |

### Always Available Tools

Certain tools are accessible regardless of the current agent:

- `question`: Ask the user a clarifying question with selectable options
- `task`: Spawn a sub-agent session
- `todowrite` / `todoread`: Manage session task lists

## Available Tools

### Read Tools

These tools help Kilo Code understand your code and project:

- `read` - Reads file contents with line numbers
- `glob` - Finds files matching a glob pattern
- `grep` - Searches file contents with regex

### Edit Tools

These tools help Kilo Code make changes to your code:

- `edit` - Makes precise text replacements in a file
- `write` - Creates new files or fully overwrites existing ones
- `apply_patch` - Applies unified diffs (used with certain models)

For multiple replacements in one file, Kilo uses repeated `edit` calls or a patch-style edit when the model supports it.

### Execute Tools

These tools help Kilo Code run commands:

- `bash` - Runs shell commands with configurable timeout and working directory

### Web Tools

These tools help Kilo Code access web content:

- `webfetch` - Fetches a URL and returns the content
- `websearch` - Searches the web (available to Kilo/OpenRouter users)

### Browser Tools

The VS Code extension has a built-in browser automation tool powered by [Playwright MCP](https://www.npmjs.com/package/@playwright/mcp). Enable it in Settings → Browser Automation. When enabled, it registers an MCP server named `kilo-playwright` and exposes tools such as:

- `kilo-playwright_browser_navigate` - Navigate to a URL
- `kilo-playwright_browser_click` - Click an element
- `kilo-playwright_browser_type` - Type text into an element
- `kilo-playwright_browser_screenshot` - Capture a screenshot
- `kilo-playwright_browser_snapshot` - Capture an accessibility snapshot

These follow the same permission model as all MCP tools (see below).

### MCP Tools

MCP server tools are automatically available when an MCP server is connected. Tool names are namespaced as `{server}_{tool}`. See [MCP Overview](/docs/automate/mcp/overview) for details.

### Workflow Tools

These tools help manage the conversation and task flow:

- `question` - Asks you a clarifying question with selectable options
- `task` - Spawns a sub-agent (child session)
- `todowrite` - Creates and updates a session TODO list
- `todoread` - Reads the current session TODO list
- `plan` - Enters structured planning mode
- `skill` - Invokes a reusable skill (Markdown instruction module)
- `agent_manager` - Starts Agent Manager local or worktree sessions in VS Code

## Tool Calling Mechanism

### When Tools Are Called

Tools are invoked under specific conditions:

1. **Direct Task Requirements**
   - When specific actions are needed to complete a task as decided by the LLM
   - In response to user requests
   - During automated workflows

2. **Mode-Based Availability**
   - Different modes enable different tool sets
   - Mode switches can trigger tool availability changes
   - Some tools are restricted to specific modes

3. **Context-Dependent Calls**
   - Based on the current state of the workspace
   - In response to system events
   - During error handling and recovery

### Decision Process

The system uses a multi-step process to determine tool availability:

1. **Mode Validation**

   ```typescript
   isToolAllowedForMode(
       tool: string,
       modeSlug: string,
       customModes: ModeConfig[],
       toolRequirements?: Record<string, boolean>,
       toolParams?: Record<string, any>
   )
   ```

2. **Requirement Checking**
   - System capability verification
   - Resource availability
   - Permission validation

3. **Parameter Validation**
   - Required parameter presence
   - Parameter type checking
   - Value validation

## Technical Implementation

### Tool Call Processing

1. **Initialization**
   - Tool name and parameters are validated
   - Mode compatibility is checked
   - Requirements are verified

2. **Execution**

   ```typescript
   const toolCall = {
     type: "tool_call",
     name: chunk.name,
     arguments: chunk.input,
     callId: chunk.callId,
   }
   ```

3. **Result Handling**
   - Success/failure determination
   - Result formatting
   - Error handling

### Security and Permissions

1. **Access Control**
   - File system restrictions
   - Command execution limitations
   - Network access controls

2. **Validation Layers**
   - Tool-specific validation
   - Mode-based restrictions
   - System-level checks

## Mode Integration

### Mode-Based Tool Access

Tools are made available based on the current mode:

- **Code Mode**: Full access to file system tools, code editing capabilities, command execution
- **Ask Mode**: Limited to reading tools, information gathering capabilities, no file system modifications
- **Architect Mode**: Design-focused tools, documentation capabilities, limited execution rights
- **Custom Modes**: Can be configured with specific tool access for specialized workflows

### Mode Switching

1. **Process**
   - Current mode state preservation
   - Tool availability updates
   - Context switching

2. **Impact on Tools**
   - Tool set changes
   - Permission adjustments
   - Context preservation

## Best Practices

### Tool Usage Guidelines

1. **Efficiency**
   - Use the most specific tool for the task
   - Avoid redundant tool calls
   - Batch operations when possible

2. **Security**
   - Validate inputs before tool calls
   - Use minimum required permissions
   - Follow security best practices

3. **Error Handling**
   - Implement proper error checking
   - Provide meaningful error messages
   - Handle failures gracefully

### Common Patterns

1. **Information Gathering**

   ```
   `question` → `read` → `grep`
   ```

2. **Code Modification**

   ```
   `read` → `edit` → final response
   ```

3. **Task Management**

   ```
   `task` → `bash` → final response
   ```

4. **Progress Tracking**
   ```
   `todowrite` → `bash` → `todowrite`
   ```

## Error Handling and Recovery

### Error Types

1. **Tool-Specific Errors**
   - Parameter validation failures
   - Execution errors
   - Resource access issues

2. **System Errors**
   - Permission denied
   - Resource unavailable
   - Network failures

3. **Context Errors**
   - Invalid mode for tool
   - Missing requirements
   - State inconsistencies

### Recovery Strategies

1. **Automatic Recovery**
   - Retry mechanisms
   - Fallback options
   - State restoration

2. **User Intervention**
   - Error notifications
   - Recovery suggestions
   - Manual intervention options
