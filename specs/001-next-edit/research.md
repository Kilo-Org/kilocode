# Research: Next Edit Feature

**Feature**: Next Edit  
**Date**: 2026-01-13  
**Phase**: 0 - Research & Technical Decisions

## Overview

This document captures research findings and technical decisions for implementing the Next Edit feature in Kilo Code, a VSCode extension for AI-assisted code editing.

## Technical Decisions

### 1. Edit Analysis Strategy

**Decision**: Hybrid approach combining semantic analysis with pattern matching

**Rationale**:

- Semantic analysis (via language servers) provides context-aware suggestions
- Pattern matching ensures comprehensive coverage across all file types
- Hybrid approach balances accuracy with performance

**Alternatives Considered**:

- Pure semantic analysis: Too slow, limited to supported languages
- Pure pattern matching: Lacks context, produces false positives
- AI-only analysis: Expensive, requires network connectivity

**Implementation**:

```typescript
// Use existing codebase indexing service
// Augment with language server integration
// Fall back to regex patterns for unsupported languages
```

### 2. Session State Management

**Decision**: In-memory state with optional persistence to VSCode workspace storage

**Rationale**:

- In-memory provides fast access during active session
- Workspace storage allows session restoration across VSCode restarts
- No external database required (simplifies deployment)

**Alternatives Considered**:

- SQLite database: Overkill for single-user feature
- File-based storage: Slower, more complex to manage
- Cloud storage: Privacy concerns, requires network

**Implementation**:

```typescript
// Use VSCode's workspaceState API
// Serialize session data to JSON
// Restore on extension activation
```

### 3. Git Integration Level

**Decision**: Read-only integration for diff preview, no automatic staging

**Rationale**:

- Users maintain control over git workflow
- Preview diffs help users understand impact
- Avoids conflicts with existing git workflows

**Alternatives Considered**:

- Automatic staging: Too opinionated, conflicts with user preferences
- Full git integration: Overly complex, duplicates git extension functionality
- No git integration: Misses valuable context

**Implementation**:

```typescript
// Use simple-git for diff generation
// Display unified diff in preview panel
// Let user decide when to commit
```

### 4. Undo/Redo Implementation

**Decision**: Two-level undo system (edit-level and session-level)

**Rationale**:

- Edit-level undo allows granular control
- Session-level undo enables bulk rollback
- Both levels address different use cases

**Alternatives Considered**:

- Single-level undo: Insufficient for complex refactors
- Git-based undo: Too slow for quick iterations
- No undo: Poor user experience

**Implementation**:

```typescript
// Maintain stack of applied edits
// Track file snapshots before each edit
// Support both undo last edit and undo all edits
```

### 5. UI Framework Choice

**Decision**: Extend existing React webview UI with new panel component

**Rationale**:

- Consistent with existing Kilo Code architecture
- Leverages existing VSCode theme integration
- Familiar to current users

**Alternatives Considered**:

- VSCode webview provider directly: More complex, no component reusability
- Separate window: Breaks workflow, poor integration
- Terminal-based UI: Limited functionality, poor UX

**Implementation**:

```typescript
// Create NextEditPanel.tsx component
// Use existing Tailwind CSS setup
// Integrate with VSCode webview API
```

## Architecture Decisions

### Service Layer Structure

```
src/services/next-edit/
├── NextEditSession.ts      # Session lifecycle management
├── EditAnalyzer.ts         # Codebase analysis
├── EditSequencer.ts        # Edit ordering logic
├── EditExecutor.ts         # Apply edits with undo support
└── SessionStorage.ts       # Persistence layer
```

### Integration Points

1. **Codebase Indexing Service**: Use existing `src/services/code-index/`
2. **ApplyDiff Tool**: Leverage existing `src/core/tools/apply-diff.ts`
3. **Chat Interface**: Extend `webview-ui/src/components/`
4. **Command Palette**: Register new commands in `src/activate/`

### Performance Considerations

- **Caching**: Cache analysis results per workspace
- **Lazy Loading**: Load edit suggestions on-demand
- **Incremental Analysis**: Only reanalyze changed files
- **Memory Management**: Prune old sessions, limit history size

## Technology Stack

| Component        | Technology            | Justification                     |
| ---------------- | --------------------- | --------------------------------- |
| Language         | TypeScript 5.4.5      | Existing project standard         |
| UI Framework     | React + Tailwind CSS  | Consistent with existing codebase |
| State Management | React hooks + Context | Simple, no external dependencies  |
| Git Integration  | simple-git            | Lightweight, well-maintained      |
| Testing          | vitest                | Existing project standard         |
| Storage          | VSCode workspaceState | Built-in, no external deps        |

## Security & Privacy

- **Local Processing**: All analysis happens locally
- **No External APIs**: Only uses VSCode and language server APIs
- **User Consent**: Explicit opt-in for each session
- **Data Retention**: Session data stored locally, no cloud sync

## Accessibility

- **Keyboard Navigation**: Full keyboard support for all actions
- **Screen Reader**: ARIA labels on all interactive elements
- **High Contrast**: Respects VSCode theme system
- **Focus Management**: Logical tab order, visible focus indicators

## Open Questions Resolved

### Q1: Should edits be applied automatically to git staging?

**Answer**: No - applied to working directory only

**Rationale**:

- Users have diverse git workflows
- Automatic staging conflicts with existing practices
- Preview diffs provide sufficient context without staging

### Q2: Should Next Edit support undo at file level or edit level?

**Answer**: Both levels supported

**Rationale**:

- Edit-level undo for granular control
- File-level undo for bulk rollback
- Addresses different use cases effectively

## Next Steps

1. Create data model specification
2. Define API contracts
3. Generate quickstart guide
4. Update agent context

## References

- VSCode Extension API: https://code.visualstudio.com/api
- simple-git Documentation: https://github.com/stevelukin/git-js
- React Webview Guide: https://code.visualstudio.com/api/extension-guides/webview
