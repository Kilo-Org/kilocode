---
title: Tool Use Details
description: Learn how Kilo Code's tools automate your development workflow
---

# Tool Use Overview

Kilo Code implements a sophisticated tool system that allows AI models to interact with your development environment in a controlled and secure manner. This document explains how tools work, when they're called, and how they're managed.

## Core Concepts

### Tool Groups

Tools are organized into logical groups based on their functionality:

| Category           | Purpose                           | Tools                                                                                                                                                                                                                                                                                     | Common Use                                         |
| ------------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Read Group**     | File system reading and searching | [read_file](/docs/features/tools/read-file), [search_files](/docs/features/tools/search-files), [list_files](/docs/features/tools/list-files), [list_code_definition_names](/docs/features/tools/list-code-definition-names)                                                              | Code exploration and analysis                      |
| **Edit Group**     | File system modifications         | [apply_diff](/docs/features/tools/apply-diff), [delete_file](/docs/features/tools/delete-file), [write_to_file](/docs/features/tools/write-to-file)                                                                                                                                       | Code changes and file manipulation                 |
| **Browser Group**  | Web automation                    | [browser_action](/docs/features/tools/browser-action)                                                                                                                                                                                                                                     | Web testing and interaction                        |
| **Command Group**  | System command execution          | [execute_command](/docs/features/tools/execute-command)                                                                                                                                                                                                                                   | Running scripts, building projects                 |
| **MCP Group**      | External tool integration         | [use_mcp_tool](/docs/features/tools/use-mcp-tool), [access_mcp_resource](/docs/features/tools/access-mcp-resource)                                                                                                                                                                        | Specialized functionality through external servers |
| **Workflow Group** | Mode and task management          | [switch_mode](/docs/features/tools/switch-mode), [new_task](/docs/features/tools/new-task), [ask_followup_question](/docs/features/tools/ask-followup-question), [attempt_completion](/docs/features/tools/attempt-completion), [update_todo_list](/docs/features/tools/update-todo-list) | Context switching and task organization            |

### Always Available Tools

Certain tools are accessible regardless of the current mode:

- [ask_followup_question](/docs/features/tools/ask-followup-question): Gather additional information from users
- [attempt_completion](/docs/features/tools/attempt-completion): Signal task completion
- [switch_mode](/docs/features/tools/switch-mode): Change operational modes
- [new_task](/docs/features/tools/new-task): Create subtasks
- [update_todo_list](/docs/features/tools/update-todo-list): Manage step-by-step task tracking

## Available Tools

### Read Tools

These tools help Kilo Code understand your code and project:

- [read_file](/docs/features/tools/read-file) - Examines the contents of files
- [search_files](/docs/features/tools/search-files) - Finds patterns across multiple files
- [list_files](/docs/features/tools/list-files) - Maps your project's file structure
- [list_code_definition_names](/docs/features/tools/list-code-definition-names) - Creates a structural map of your code

### Edit Tools

These tools help Kilo Code make changes to your code:

- [apply_diff](/docs/features/tools/apply-diff) - Makes precise, surgical changes to your code
- [delete_file](/docs/features/tools/delete-file) - Removes files from your workspace
- [write_to_file](/docs/features/tools/write-to-file) - Creates new files or completely rewrites existing ones

### Browser Tools

These tools help Kilo Code interact with web applications:

- [browser_action](/docs/features/tools/browser-action) - Automates browser interactions

### Command Tools

These tools help Kilo Code execute commands:

- [execute_command](/docs/features/tools/execute-command) - Runs system commands and programs

### MCP Tools

These tools help Kilo Code connect with external services:

- [use_mcp_tool](/docs/features/tools/use-mcp-tool) - Uses specialized external tools
- [access_mcp_resource](/docs/features/tools/access-mcp-resource) - Accesses external data sources

### Workflow Tools

These tools help manage the conversation and task flow:

- [ask_followup_question](/docs/features/tools/ask-followup-question) - Gets additional information from you
- [attempt_completion](/docs/features/tools/attempt-completion) - Presents final results
- [switch_mode](/docs/features/tools/switch-mode) - Changes to a different mode for specialized tasks
- [new_task](/docs/features/tools/new-task) - Creates a new subtask
- [update_todo_list](/docs/features/tools/update-todo-list) - Tracks task progress with step-by-step checklists

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
    [ask_followup_question](/docs/features/tools/ask-followup-question) → [read_file](/docs/features/tools/read-file) → [search_files](/docs/features/tools/search-files)
    ```

2. **Code Modification**

    ```
    [read_file](/docs/features/tools/read-file) → [apply_diff](/docs/features/tools/apply-diff) → [attempt_completion](/docs/features/tools/attempt-completion)
    ```

3. **Task Management**

    ```
    [new_task](/docs/features/tools/new-task) → [switch_mode](/docs/features/tools/switch-mode) → [execute_command](/docs/features/tools/execute-command)
    ```

4. **Progress Tracking**
    ```
    [update_todo_list](/docs/features/tools/update-todo-list) → [execute_command](/docs/features/tools/execute-command) → [update_todo_list](/docs/features/tools/update-todo-list)
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
