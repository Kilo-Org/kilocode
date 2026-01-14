# Implementation Plan: Next Edit

**Branch**: `001-next-edit` | **Date**: 2026-01-13 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-next-edit/spec.md`

## Summary

Next Edit is a VSCode extension feature that enables users to flow through complex code changes across their codebase. It analyzes the codebase to identify locations requiring similar edits (refactoring, library upgrades, schema changes) and presents them sequentially for review and application. The feature includes undo/redo support, progress tracking, and git integration for diff preview.

**Technical Approach**: Hybrid analysis combining semantic language server integration with pattern matching, backed by in-memory session state with optional VSCode workspace storage for persistence.

## Technical Context

**Language/Version**: TypeScript 5.4.5  
**Primary Dependencies**: React, VSCode Extension API, simple-git, vitest  
**Storage**: VSCode workspaceState API (in-memory with optional persistence)  
**Testing**: vitest with workspace-specific test commands  
**Target Platform**: VSCode 1.70+  
**Project Type**: Single project (VSCode extension with webview UI)  
**Performance Goals**: Edit suggestions < 3 seconds for 1000 files, session restore < 1 second, memory < 100MB  
**Constraints**: No external cloud services, local processing only, respects user privacy  
**Scale/Scope**: Supports up to 1000 files per session, typical usage 50-200 edits

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Principle Compliance

| Principle                                | Status  | Notes                                                                                               |
| ---------------------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| I. Monorepo Architecture                 | ✅ PASS | Feature integrates into existing pnpm workspace, uses Turbo for orchestration                       |
| II. VSCode Extension as Primary          | ✅ PASS | Core feature for VSCode extension, uses webview UI with React                                       |
| III. Test Coverage Before Implementation | ✅ PASS | Tests will be written first using vitest, placed alongside source files                             |
| IV. Fork Compatibility                   | ✅ PASS | New files in `src/services/next-edit/` (Kilo-specific), modifications marked with `kilocode_change` |
| V. AI Provider Abstraction               | ✅ PASS | Uses existing provider abstraction, no new provider implementations needed                          |

**Result**: ✅ All gates passed - Proceed with implementation

## Project Structure

### Documentation (this feature)

```text
specs/001-next-edit/
├── spec.md              # Feature specification
├── plan.md              # This file (implementation plan)
├── research.md          # Phase 0 output (research findings)
├── data-model.md        # Phase 1 output (data model)
├── quickstart.md        # Phase 1 output (quickstart guide)
├── contracts/           # Phase 1 output (API contracts)
│   └── api.ts           # TypeScript API contracts
└── tasks.md             # Phase 2 output (NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── services/
│   └── next-edit/                    # New service directory
│       ├── NextEditSession.ts        # Session lifecycle management
│       ├── EditAnalyzer.ts           # Codebase analysis
│       ├── EditSequencer.ts          # Edit ordering logic
│       ├── EditExecutor.ts           # Apply edits with undo support
│       └── SessionStorage.ts         # Persistence layer
├── activate/
│   └── registerCommands.ts          # Register Next Edit commands (modified)
└── core/
    └── tools/
        └── next-edit.ts              # Next Edit tool implementation (new)

webview-ui/
└── src/
    └── components/
        └── NextEditPanel.tsx         # Edit review UI component (new)

tests/
└── services/
    └── next-edit/                    # Service tests
        ├── NextEditSession.spec.ts
        ├── EditAnalyzer.spec.ts
        ├── EditSequencer.spec.ts
        └── EditExecutor.spec.ts
```

**Structure Decision**: Single project structure following existing Kilo Code monorepo pattern. New service in `src/services/next-edit/` with corresponding tests. Webview UI component extends existing React setup.

## Complexity Tracking

> **No violations** - All gates passed without requiring complexity justifications.

## Phase 0: Research & Technical Decisions

### Completed Research

**Output**: [`research.md`](./research.md)

**Key Decisions**:

1. **Edit Analysis**: Hybrid approach (semantic + pattern matching)
2. **Session State**: In-memory with VSCode workspaceState persistence
3. **Git Integration**: Read-only for diff preview, no automatic staging
4. **Undo/Redo**: Two-level system (edit-level and session-level)
5. **UI Framework**: Extend existing React webview UI

**Resolved Questions**:

- Edits applied to working directory only (not auto-staged)
- Both edit-level and session-level undo supported

## Phase 1: Design & Contracts

### Data Model

**Output**: [`data-model.md`](./data-model.md)

**Core Entities**:

- `EditSession`: Session lifecycle and state
- `EditSuggestion`: Individual edit with context
- `EditAction`: User decisions on edits
- `EditContext`: Metadata about edit location
- `EditSequence`: Ordered collection of edits

**Validation Rules**: Defined for all entities with type checking and range validation

### API Contracts

**Output**: [`contracts/api.ts`](./contracts/api.ts)

**API Groups**:

1. **Session Management**: Start, pause, resume, cancel sessions
2. **Edit Management**: Get next edit, accept, skip, undo, redo
3. **Bulk Operations**: Bulk accept, get summary
4. **Git Integration**: Get diff, preview all changes

**Event Types**: Defined for webview ↔ extension communication

### Quickstart Guide

**Output**: [`quickstart.md`](./quickstart.md)

**Contents**:

- Core concepts overview
- API usage examples
- Common workflows
- Integration points (VSCode commands, webview UI)
- Keyboard shortcuts
- Testing examples
- Troubleshooting guide

### Agent Context Update

**Output**: Updated `.kilocode/rules/specify-rules.md`

**Changes**:

- Added Next Edit to active technologies
- Updated project structure reference
- Ready for implementation phase

## Phase 2: Implementation Planning

### Implementation Tasks

**Note**: This section will be populated by `/speckit.tasks` command. The following is a high-level outline:

#### Backend Services

1. **Session Storage Service**

    - Implement VSCode workspaceState persistence
    - Add session serialization/deserialization
    - Implement session restore logic

2. **Edit Analyzer Service**

    - Integrate with codebase indexing service
    - Implement semantic analysis via language servers
    - Add pattern matching fallback
    - Generate edit suggestions with confidence scores

3. **Edit Sequencer Service**

    - Implement dependency resolution
    - Add priority-based ordering
    - Detect circular dependencies
    - Generate edit sequences

4. **Edit Executor Service**

    - Integrate with existing ApplyDiff tool
    - Implement undo/redo stack management
    - Add file-level undo support
    - Track edit history

5. **Next Edit Session Service**
    - Orchestrate all services
    - Manage session lifecycle
    - Handle session state transitions
    - Provide progress tracking

#### Extension Integration

6. **Command Registration**

    - Register Next Edit commands in VSCode
    - Add keyboard shortcuts
    - Implement command handlers

7. **Webview Communication**
    - Set up message passing between extension and webview
    - Implement event handlers
    - Add error handling

#### Webview UI

8. **Next Edit Panel Component**

    - Create React component for edit review
    - Implement diff display
    - Add action buttons (accept, skip, undo)
    - Show progress indicator

9. **Session Start Dialog**
    - Create dialog for goal input
    - Add pattern configuration options
    - Implement validation

#### Testing

10. **Unit Tests**

    - Test all service modules
    - Test entity validation
    - Test state transitions

11. **Integration Tests**

    - Test command registration
    - Test webview communication
    - Test session lifecycle

12. **E2E Tests**
    - Test complete user workflows
    - Test undo/redo functionality
    - Test git integration

#### Documentation

13. **User Documentation**

    - Update README with Next Edit section
    - Add feature documentation
    - Create tutorial examples

14. **Developer Documentation**
    - Update API documentation
    - Add architecture diagrams
    - Document testing strategy

### Dependencies

**Internal**:

- Codebase indexing service (`src/services/code-index/`)
- ApplyDiff tool (`src/core/tools/apply-diff.ts`)
- Chat interface (`webview-ui/`)
- VSCode extension API

**External**:

- `simple-git`: Git diff generation
- `uuid`: UUID generation for session/edit IDs
- Existing React and TypeScript dependencies

### Performance Considerations

- **Caching**: Cache analysis results per workspace
- **Lazy Loading**: Load edit suggestions on-demand
- **Incremental Analysis**: Only reanalyze changed files
- **Memory Management**: Prune old sessions, limit history size
- **Pagination**: Display edits in batches (10 at a time)

### Security & Privacy

- **Local Processing**: All analysis happens locally
- **No External APIs**: Only uses VSCode and language server APIs
- **User Consent**: Explicit opt-in for each session
- **Data Retention**: Session data stored locally, no cloud sync

### Accessibility

- **Keyboard Navigation**: Full keyboard support for all actions
- **Screen Reader**: ARIA labels on all interactive elements
- **High Contrast**: Respects VSCode theme system
- **Focus Management**: Logical tab order, visible focus indicators

## Success Criteria

From feature specification:

1. **Efficiency**: Users can complete refactoring tasks 40% faster than manual editing
2. **Accuracy**: 95% of suggested edits are correct and require no modification
3. **User Satisfaction**: Users rate the feature 4+ out of 5 for ease of use
4. **Adoption**: 30% of users use Next Edit for refactoring tasks within 3 months
5. **Performance**: Edit suggestions appear within 3 seconds of request

**Measurement Methods**:

- Track time spent on refactoring tasks
- Survey users for satisfaction ratings
- Monitor feature usage analytics
- Measure edit acceptance rate

## Risks and Mitigations

| Risk                  | Impact | Likelihood | Mitigation                             |
| --------------------- | ------ | ---------- | -------------------------------------- |
| Poor edit suggestions | High   | Medium     | Highlighting, easy skip, user feedback |
| Performance issues    | Medium | Low        | Caching, incremental analysis          |
| User confusion        | Medium | Medium     | Clear UI, onboarding tutorial          |
| Missing locations     | High   | Low        | Multiple analysis passes, user review  |

## Next Steps

1. Run `/speckit.tasks` to generate detailed task breakdown
2. Begin implementation with Session Storage Service
3. Write tests before implementation (TDD approach)
4. Iterate through services in dependency order
5. Integrate with extension and webview UI
6. Conduct thorough testing
7. Update documentation
8. Create changeset for release

## References

- [Feature Specification](./spec.md)
- [Research Findings](./research.md)
- [Data Model](./data-model.md)
- [API Contracts](./contracts/api.ts)
- [Quickstart Guide](./quickstart.md)
- [Kilo Code Constitution](../../.specify/memory/constitution.md)
- [VSCode Extension API](https://code.visualstudio.com/api)
