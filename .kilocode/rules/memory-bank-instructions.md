# Memory Bank System

## Core Functionality
- Memory Bank provides persistent project context across coding sessions
- Files stored in `.kilocode/rules/memory-bank/` folder
- All files loaded at the start of every task
- Successful activation indicated by 🧠💾 emoji tag

## Core Files
- **brief.md**: Project overview and goals
- **product.md**: Problem statement and solution
- **context.md**: Current work focus and recent changes
- **architecture.md**: System design and technical decisions
- **tech.md**: Technologies and development setup

## Operation
- Files loaded at task start, not with every message
- Updates made by editing markdown files directly
- Command: "update memory bank" to refresh analysis