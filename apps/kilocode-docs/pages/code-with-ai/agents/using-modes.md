---
title: "Using Modes"
description: "Understanding and using different modes in Kilo Code"
---

# Using Modes

Modes in Kilo Code are specialized personas that tailor the assistant's behavior to your current task. Each mode offers different capabilities, expertise, and access levels to help you accomplish specific goals.

## Why Use Different Modes?

- **Task specialization:** Get precisely the type of assistance you need for your current task
- **Safety controls:** Prevent unintended file modifications when focusing on planning or learning
- **Focused interactions:** Receive responses optimized for your current activity
- **Workflow optimization:** Seamlessly transition between planning, implementing, debugging, and learning

{% youtube url="https://youtu.be/cS4vQfX528w" caption="Explaining the different modes in Kilo Code" /%}

## Switching Between Modes

Four ways to switch modes:

1. **Dropdown menu:** Click the selector to the left of the chat input

    {% image src="/docs/img/modes/modes.png" alt="Using the dropdown menu to switch modes" width="400" /%}

2. **Slash command:** Type `/architect`, `/ask`, `/debug`, or `/code` in the chat input

    {% image src="/docs/img/modes/modes-1.png" alt="Using slash commands to switch modes" width="400" /%}

3. **Toggle command/Keyboard shortcut:** Use the keyboard shortcut below, applicable to your operating system. Each press cycles through the available modes in sequence, wrapping back to the first mode after reaching the end.

    | Operating System | Shortcut |
    | ---------------- | -------- |
    | macOS            | ⌘ + .    |
    | Windows          | Ctrl + . |
    | Linux            | Ctrl + . |

4. **Accept suggestions:** Click on mode switch suggestions that Kilo Code offers when appropriate

    {% image src="/docs/img/modes/modes-2.png" alt="Accepting a mode switch suggestion from Kilo Code" width="400" /%}

## Built-in Modes

### Code Mode (Default)

| Aspect               | Details                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| **Description**      | A skilled software engineer with expertise in programming languages, design patterns, and best practices |
| **Tool Access**      | Full access to all tool groups: `read`, `edit`, `browser`, `command`, `mcp`                              |
| **Ideal For**        | Writing code, implementing features, debugging, and general development                                  |
| **Special Features** | No tool restrictions—full flexibility for all coding tasks                                               |

### Ask Mode

| Aspect               | Details                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| **Description**      | A knowledgeable technical assistant focused on answering questions without changing your codebase |
| **Tool Access**      | Limited access: `read`, `browser`, `mcp` only (cannot edit files or run commands)                 |
| **Ideal For**        | Code explanation, concept exploration, and technical learning                                     |
| **Special Features** | Optimized for informative responses without modifying your project                                |

### Architect Mode

| Aspect               | Details                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| **Description**      | An experienced technical leader and planner who helps design systems and create implementation plans |
| **Tool Access**      | Access to `read`, `browser`, `mcp`, and restricted `edit` (markdown files only)                      |
| **Ideal For**        | System design, high-level planning, and architecture discussions                                     |
| **Special Features** | Follows a structured approach from information gathering to detailed planning                        |

### Debug Mode

| Aspect               | Details                                                                             |
| -------------------- | ----------------------------------------------------------------------------------- |
| **Description**      | An expert problem solver specializing in systematic troubleshooting and diagnostics |
| **Tool Access**      | Full access to all tool groups: `read`, `edit`, `browser`, `command`, `mcp`         |
| **Ideal For**        | Tracking down bugs, diagnosing errors, and resolving complex issues                 |
| **Special Features** | Uses a methodical approach of analyzing, narrowing possibilities, and fixing issues |

### Orchestrator Mode

| Aspect               | Details                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Description**      | A strategic workflow orchestrator who coordinates complex tasks by delegating them to appropriate specialized modes |
| **Tool Access**      | Limited access to create new tasks and coordinate workflows                                                         |
| **Ideal For**        | Breaking down complex projects into manageable subtasks assigned to specialized modes                               |
| **Special Features** | Uses the new_task tool to delegate work to other modes                                                              |

### Review Mode

| Aspect               | Details                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Description**      | An expert code reviewer specializing in analyzing changes to provide structured feedback on quality, security, and best practices |
| **Tool Access**      | Access to `read`, `browser`, `mcp`, and when permitted, `edit`                                                                    |
| **Ideal For**        | Catching issues early, enforcing code standards, accelerating PR turnaround                                                       |
| **Special Features** | Code review before committing, surfacing feedback across performance, security, style, and test coverage                          |

## Custom Modes

Create your own specialized assistants by defining tool access, file permissions, and behavior instructions. Custom modes help enforce team standards or create purpose-specific assistants. See [Custom Modes documentation](/docs/features/custom-modes) for setup instructions.

<!--
EXISTING PAGES TO MIGRATE:
- `basic-usage/using-modes` - Modes documentation

Migrate the existing modes documentation here.
-->
