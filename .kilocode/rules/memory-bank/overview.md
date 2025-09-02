# Project Overview

Kilo Code is a VSCode AI coding assistant with persistent project memory and multi-mode task execution.

## Development Constraints

- **Package Manager**: pnpm ONLY (npm blocked by preinstall script)
- **Node Version**: v20.18.1 (exact, via .nvmrc)
- **Testing**: NEVER use watch mode (causes system hang)
- **Monorepo**: pnpm workspaces + Turborepo build orchestration
