# Data Model: Next Edit Feature

**Feature**: Next Edit  
**Date**: 2026-01-13  
**Phase**: 1 - Design & Contracts

## Overview

This document defines the data model for the Next Edit feature, including entities, relationships, validation rules, and state transitions.

## Core Entities

### 1. EditSession

Represents a single Next Edit session with a sequence of edits.

```typescript
interface EditSession {
	// Identification
	id: string // UUID v4
	workspaceUri: string // VSCode workspace URI
	createdAt: Date // Session start timestamp
	updatedAt: Date // Last activity timestamp

	// Session State
	status: SessionStatus // Current session state
	goal: string // User's edit goal description

	// Edit Tracking
	edits: EditSuggestion[] // All suggested edits
	currentEditIndex: number // Currently active edit index
	completedEdits: string[] // IDs of completed edits
	skippedEdits: string[] // IDs of skipped edits

	// Undo History
	undoStack: EditAction[] // Applied edits for undo
	redoStack: EditAction[] // Undone edits for redo

	// Metadata
	totalFiles: number // Total files analyzed
	estimatedTime: number // Estimated completion time (seconds)
}

enum SessionStatus {
	INITIALIZING = "initializing",
	ACTIVE = "active",
	PAUSED = "paused",
	COMPLETED = "completed",
	CANCELLED = "cancelled",
	ERROR = "error",
}
```

**Validation Rules**:

- `id` must be a valid UUID v4
- `goal` must be non-empty, max 500 characters
- `currentEditIndex` must be >= 0 and < `edits.length`
- `completedEdits` and `skippedEdits` must be disjoint sets

**State Transitions**:

```
INITIALIZING → ACTIVE
ACTIVE → PAUSED
PAUSED → ACTIVE
ACTIVE → COMPLETED
ACTIVE → CANCELLED
ACTIVE → ERROR
PAUSED → CANCELLED
```

### 2. EditSuggestion

A single suggested edit with context and rationale.

```typescript
interface EditSuggestion {
	// Identification
	id: string // UUID v4
	sessionId: string // Parent session ID

	// Edit Content
	filePath: string // Absolute file path
	lineStart: number // Start line number (1-indexed)
	lineEnd: number // End line number (1-indexed)
	originalContent: string // Original code snippet
	suggestedContent: string // Suggested replacement

	// Context
	rationale: string // Why this edit is suggested
	confidence: number // Confidence score (0-1)
	dependencies: string[] // IDs of edits this depends on
	dependents: string[] // IDs of edits that depend on this

	// State
	status: EditStatus // Current edit status
	userModification?: string // User's modified version (if any)

	// Metadata
	language: string // File language (e.g., 'typescript', 'python')
	category: EditCategory // Type of edit
	priority: number // Priority for ordering (higher = earlier)
}

enum EditStatus {
	PENDING = "pending",
	REVIEWING = "reviewing",
	ACCEPTED = "accepted",
	SKIPPED = "skipped",
	MODIFIED = "modified",
	ERROR = "error",
}

enum EditCategory {
	REFACTOR = "refactor", // Code refactoring
	UPGRADE = "upgrade", // Library/API upgrade
	SCHEMA = "schema", // Schema change
	FIX = "fix", // Bug fix
	STYLE = "style", // Code style/formatting
}
```

**Validation Rules**:

- `id` must be a valid UUID v4
- `lineStart` must be >= 1
- `lineEnd` must be >= `lineStart`
- `confidence` must be between 0 and 1
- `dependencies` must reference valid edit IDs
- `priority` must be >= 0

**Relationships**:

- Belongs to one `EditSession`
- Can depend on multiple `EditSuggestion` (dependencies)
- Can be depended on by multiple `EditSuggestion` (dependents)

### 3. EditAction

User decision (accept, skip, modify) on a suggestion.

```typescript
interface EditAction {
	// Identification
	id: string // UUID v4
	sessionId: string // Parent session ID
	editId: string // Associated edit ID

	// Action Details
	action: ActionType // Type of action taken
	timestamp: Date // When action was taken

	// Content
	originalContent: string // Content before action
	appliedContent?: string // Content after action (if modified)

	// Metadata
	duration: number // Time spent reviewing (milliseconds)
	userNotes?: string // Optional user notes
}

enum ActionType {
	ACCEPT = "accept",
	SKIP = "skip",
	MODIFY = "modify",
	UNDO = "undo",
	REDO = "redo",
}
```

**Validation Rules**:

- `id` must be a valid UUID v4
- `duration` must be >= 0
- `userNotes` max 1000 characters (if provided)

**Relationships**:

- Belongs to one `EditSession`
- Associated with one `EditSuggestion`

### 4. EditContext

Metadata about where and why an edit is suggested.

```typescript
interface EditContext {
	// Identification
	id: string // UUID v4
	editId: string // Associated edit ID

	// Location Context
	functionName?: string // Containing function name
	className?: string // Containing class name
	moduleName?: string // Containing module name

	// Code Context
	surroundingLines: string[] // Lines before and after edit
	imports: string[] // Relevant imports
	exports: string[] // Relevant exports

	// Analysis Context
	analysisMethod: AnalysisMethod // How this edit was found
	matchedPattern?: string // Pattern that matched (if applicable)
	semanticScore: number // Semantic similarity score (0-1)

	// Metadata
	fileHash: string // Hash of file at analysis time
}

enum AnalysisMethod {
	SEMANTIC = "semantic", // Language server analysis
	PATTERN = "pattern", // Regex pattern matching
	HYBRID = "hybrid", // Combination of both
	MANUAL = "manual", // User-suggested
}
```

**Validation Rules**:

- `id` must be a valid UUID v4
- `semanticScore` must be between 0 and 1
- `surroundingLines` max 10 lines before and after

**Relationships**:

- Associated with one `EditSuggestion`

### 5. EditSequence

Ordered collection of related edits.

```typescript
interface EditSequence {
	// Identification
	id: string // UUID v4
	sessionId: string // Parent session ID
	name: string // Sequence name (e.g., "API Migration")

	// Edit Ordering
	editIds: string[] // Ordered list of edit IDs

	// Metadata
	createdAt: Date // When sequence was created
	estimatedTime: number // Estimated time for sequence (seconds)
	dependencies: string[] // IDs of sequences this depends on
}
```

**Validation Rules**:

- `id` must be a valid UUID v4
- `name` must be non-empty, max 100 characters
- `editIds` must reference valid edit IDs
- `editIds` must be unique (no duplicates)

**Relationships**:

- Belongs to one `EditSession`
- Contains multiple `EditSuggestion` (ordered)

## Entity Relationships

```
EditSession (1) ──────< (N) EditSuggestion
    │                     │
    │                     ├─< (N) EditContext
    │                     │
    │                     └─< (N) EditAction
    │
    └─────< (N) EditSequence
              │
              └─< (N) EditSuggestion
```

## Data Storage Schema

### VSCode WorkspaceState Structure

```typescript
interface NextEditWorkspaceState {
	sessions: {
		[sessionId: string]: EditSession
	}
	activeSessionId?: string
	lastSessionId?: string
}
```

### File Structure for Persistence

```
.kilocode/
└── next-edit/
    ├── sessions/
    │   └── {sessionId}.json
    └── cache/
        └── {workspaceHash}/
            └── analysis.json
```

## Indexing Strategy

### Session Index

- Primary key: `sessionId`
- Secondary key: `workspaceUri`
- Index: `createdAt` (descending)

### Edit Index

- Primary key: `editId`
- Secondary key: `sessionId`
- Index: `status` + `priority` (for pending edits)

### Action Index

- Primary key: `actionId`
- Secondary key: `sessionId`
- Index: `timestamp` (descending)

## Validation Rules Summary

| Entity         | Rule                             | Type       |
| -------------- | -------------------------------- | ---------- |
| EditSession    | id must be UUID v4               | Format     |
| EditSession    | goal non-empty, max 500 chars    | Length     |
| EditSession    | currentEditIndex in valid range  | Range      |
| EditSuggestion | lineEnd >= lineStart             | Logic      |
| EditSuggestion | confidence in [0, 1]             | Range      |
| EditSuggestion | dependencies reference valid IDs | Reference  |
| EditAction     | duration >= 0                    | Range      |
| EditContext    | semanticScore in [0, 1]          | Range      |
| EditSequence   | editIds unique                   | Uniqueness |

## Migration Strategy

### Version 1.0 (Initial)

- Create all entities with current schema
- No migration needed (fresh implementation)

### Future Considerations

- Add version field to EditSession for schema evolution
- Implement migration functions for backward compatibility
- Use JSON Schema for validation

## Performance Considerations

- **Lazy Loading**: Load edit suggestions on-demand, not all at once
- **Pagination**: Display edits in batches (e.g., 10 at a time)
- **Caching**: Cache analysis results per workspace
- **Indexing**: Maintain in-memory indexes for fast lookups
- **Pruning**: Remove old sessions after 30 days of inactivity

## Security Considerations

- **Path Validation**: Validate all file paths are within workspace
- **Content Sanitization**: Sanitize user-provided content before storage
- **Access Control**: Ensure sessions are isolated per workspace
- **Data Encryption**: Consider encrypting sensitive session data

## Testing Strategy

- **Unit Tests**: Test individual entity validation
- **Integration Tests**: Test entity relationships and state transitions
- **Performance Tests**: Test with large datasets (1000+ edits)
- **Edge Cases**: Test empty sessions, circular dependencies, etc.
