# Project Overview

Kilo Code is a VSCode AI coding assistant with persistent project memory and multi-mode task execution.

## Current Major Work

### Task History Architecture Simplification (In Progress)

**Status**: 🔄 Mid-Implementation Review - Simplifying event architecture

**Current State**:

- **Backend Service**: Excellent TaskHistoryService with 46/46 tests passing
- **Performance Goal**: Successfully achieved - reduced initial data transfer to 10 items
- **Issue Identified**: Event proliferation and complex message handling needs simplification

**Key Issues to Address**:

- **Event Proliferation**: 5 separate events need consolidation into single `searchTaskHistory`
- **Complex Message Handler**: Switch-within-switch pattern creates confusion
- **Frontend Complexity**: Multiple hooks with unnecessary abstraction layers
- **Missing Correlation**: No request/response correlation mechanism

**Planned Improvements**:

- Single unified `searchTaskHistory` event with comprehensive filters
- Simplified message handler with proper request correlation
- Consolidated frontend hook for better maintainability
- Preserved performance benefits and test coverage

**Benefits Expected**:

- Simpler mental model and debugging
- Better request/response correlation
- Reduced code complexity and bundle size
- Maintained performance improvements

## Development Constraints

- **Package Manager**: pnpm ONLY (npm blocked by preinstall script)
- **Node Version**: v20.18.1 (exact, via .nvmrc)
- **Testing**: NEVER use watch mode (causes system hang)
- **Monorepo**: pnpm workspaces + Turborepo build orchestration
