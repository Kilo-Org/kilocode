# Memory Bank System

## Core Functionality

Memory resets completely between sessions. Memory Bank provides persistent project context across coding sessions. Files stored in `.kilocode/rules/memory-bank/` folder. All files loaded at the start of every task. Successful activation indicated by `[Memory Bank: Active]` at start of response, or `[Memory Bank: Missing]` if folder doesn't exist.

## Core Files

- **overview.md**: Project overview and goals (manually maintained by developer - source of truth)
- **architecture.md**: System design and technical decisions
- **tech.md**: Technologies and development setup

## Key Workflows

### Initialization (`initialize memory bank`)

Perform exhaustive project analysis including source code, configuration, structure, dependencies, and patterns. Be extremely thorough - this defines all future effectiveness. After initialization, ask user to verify accuracy and correct any misunderstandings.

### Update (`update memory bank`)

Review ALL memory bank files when:

- Discovering new project patterns
- After significant changes
- User explicitly requests
- Context needs clarification

### Add Task (`add task` or `store this as a task`)

Document repetitive tasks in `tasks.md` with:

- Task name and description
- Files to modify
- Step-by-step workflow
- Important considerations
- Example implementation

### Regular Task Execution

1. Read ALL memory bank files at start of EVERY task (required)
2. Include `[Memory Bank: Active]` or `[Memory Bank: Missing]` at response start
3. Briefly summarize project understanding
4. Follow documented workflows from `tasks.md` when applicable
5. Update `overview.md` at task completion
6. Suggest memory bank update for significant changes

## Operation

- Files loaded at task start, not with every message
- Updates made by editing markdown files directly
- Command: "update memory bank" to refresh analysis
- Overview.md is source of truth for project scope
