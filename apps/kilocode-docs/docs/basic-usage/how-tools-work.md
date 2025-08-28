# How Tools Work

Kilo Code uses tools to interact with your code and environment. These specialized helpers perform specific actions like reading files, making edits, running commands, or searching your codebase. Tools provide automation for common development tasks without requiring manual execution.

## Tool Workflow

Describe what you want to accomplish in natural language, and Kilo Code will:

1. Select the appropriate tool based on your request
2. Present the tool with its parameters for your review
3. Execute the approved tool and show you the results
4. Continue this process until your task is complete

## Tool Categories

| Category | Purpose | Tool Names |
| :------- | :------ | :--------- |
| Read | Access file content and code structure | `read_file`, `search_files`, `list_files`, `list_code_definition_names` |
| Edit | Create or modify files and code | `write_to_file`, `apply_diff` |
| Execute | Run commands and perform system operations | `execute_command` |
| Browser | Interact with web content | `browser_action` |
| Workflow | Manage task flow and context | `ask_followup_question`, `attempt_completion`, `switch_mode`, `new_task` |

## Example: Using Tools

Here's how a typical tool interaction works:

<img src="/docs/img/how-tools-work/how-tools-work.png" alt="Tool approval interface showing Save and Reject buttons along with Auto-approve checkbox" width="600" />

*The tool approval interface shows Save/Reject buttons and Auto-approve options.*

**User:** Create a file named `greeting.js` that logs a greeting message

**Kilo Code:** (Proposes the `write_to_file` tool as shown in the image above)
```xml
<write_to_file>
<path>greeting.js</path>
<content>
function greet(name) {
  console.log(`Hello, ${name}!`);
}

greet('World');
</content>
<line_count>5</line_count>
</write_to_file>
```

**User:** (Clicks "Save" in the interface)

**Kilo Code:** (Confirms file creation)

## Tool Safety and Approval


Every tool use requires your explicit approval. When Kilo proposes a tool, you'll see:

* A "Save" button to approve and execute the tool
* A "Reject" button to decline the proposed tool
* An optional "Auto-approve" setting for trusted operations

This safety mechanism ensures you maintain control over which files are modified, what commands are executed, and how your codebase is changed. Always review tool proposals carefully before saving them.

## Core Tools Reference

| Tool Name | Description | Category |
| :-------- | :---------- | :------- |
| `read_file` | Reads the content of a file with line numbers | Read |
| `search_files` | Searches for text or regex patterns across files | Read |
| `list_files` | Lists files and directories in a specified location | Read |
| `list_code_definition_names` | Lists code definitions like classes and functions | Read |
| `write_to_file` | Creates new files or overwrites existing ones | Edit |
| `apply_diff` | Makes precise changes to specific parts of a file | Edit |
| `execute_command` | Runs commands in the VS Code terminal | Execute |
| `browser_action` | Performs actions in a headless browser | Browser |
| `ask_followup_question` | Asks you a clarifying question | Workflow |
| `attempt_completion` | Indicates the task is complete | Workflow |
| `switch_mode` | Changes to a different operational mode | Workflow |
| `new_task` | Creates a new subtask with a specific starting mode | Workflow |

## Learn More About Tools

For more detailed information about each tool, including complete parameter references and advanced usage patterns, see the [Tool Use Overview](/features/tools/tool-use-overview) documentation.
