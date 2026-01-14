# Feature Specification: Next Edit

## Overview

**Short Name:** next-edit  
**Feature ID:** 1  
**Status:** Draft  
**Created:** 2026-01-13

### Summary

Implement a "Next Edit" feature that allows users to flow through complex changes across their codebase. This feature cuts down the time spent on repetitive work like refactors, library upgrades, and schema changes by suggesting and applying sequential edits.

---

## Problem Statement

Developers frequently need to make similar edits across multiple files (refactoring, library upgrades, schema changes). Currently, they must:

- Manually find all locations requiring changes
- Apply edits one by one
- Track progress mentally
- Risk missing locations

This is error-prone and time-consuming for large codebases.

---

## User Scenarios & Testing

### Scenario 1: Refactoring Variable Names

**Given** a developer wants to rename a function across multiple files  
**When** they initiate a "Next Edit" session  
**Then** the system should suggest edits one at a time in contextually appropriate locations  
**And** each edit should be reviewable before application

**Testing Criteria:**

- All occurrences are found and indexed
- Edits are presented in logical order
- User can accept/skip/modify each edit
- Progress is tracked and visible

### Scenario 2: Library Upgrade

**Given** a developer needs to upgrade a library API across the codebase  
**When** they specify the upgrade requirements  
**Then** the system should identify all locations requiring changes  
**And** present them in a logical sequence for sequential editing

**Testing Criteria:**

- API usage patterns are detected
- Change suggestions are accurate
- Related changes are grouped together
- Total time saved is measurable

### Scenario 3: Schema Changes

**Given** a developer modified a database schema  
**When** they need to update all related code references  
**Then** the system should track dependencies and suggest edits in dependency order

**Testing Criteria:**

- Dependency relationships are understood
- Circular dependencies are detected
- Changes don't break build
- All affected files are covered

---

## Functional Requirements

| ID     | Requirement                                                                         | Priority    | Acceptance Criteria                         |
| ------ | ----------------------------------------------------------------------------------- | ----------- | ------------------------------------------- |
| REQ-01 | System shall allow users to initiate a "Next Edit" session from the chat interface  | Must Have   | Session starts within 3 seconds of command  |
| REQ-02 | System shall analyze the codebase to identify all locations requiring similar edits | Must Have   | 95% of relevant locations identified        |
| REQ-03 | System shall present edits one at a time in a logical sequence                      | Must Have   | User receives edit suggestions sequentially |
| REQ-04 | Users shall be able to review each edit before applying it                          | Must Have   | Edit diff is visible before confirmation    |
| REQ-05 | Users shall be able to skip, modify, or accept each edit                            | Must Have   | All three actions are available             |
| REQ-06 | System shall track progress through the edit sequence                               | Should Have | Progress bar shows current/total            |
| REQ-07 | System shall provide a summary of all pending edits                                 | Should Have | Summary view is accessible                  |
| REQ-08 | Users shall be able to undo/redo individual edits within a session                  | Could Have  | Undo/redo buttons work correctly            |
| REQ-09 | System shall support bulk application of similar edits                              | Could Have  | Bulk apply completes without errors         |
| REQ-10 | System shall integrate with version control to show diffs before applying           | Should Have | Git diff is displayed in preview            |

---

## Success Criteria

1. **Efficiency**: Users can complete refactoring tasks 40% faster than manual editing
2. **Accuracy**: 95% of suggested edits are correct and require no modification
3. **User Satisfaction**: Users rate the feature 4+ out of 5 for ease of use
4. **Adoption**: 30% of users use Next Edit for refactoring tasks within 3 months
5. **Performance**: Edit suggestions appear within 3 seconds of request

**Measurement Methods:**

- Track time spent on refactoring tasks
- Survey users for satisfaction ratings
- Monitor feature usage analytics
- Measure edit acceptance rate

---

## Key Entities

| Entity         | Type   | Description                                                  |
| -------------- | ------ | ------------------------------------------------------------ |
| EditSession    | Domain | Represents a single Next Edit session with sequence of edits |
| EditSuggestion | Domain | A single suggested edit with context and rationale           |
| EditContext    | Domain | Metadata about where and why an edit is suggested            |
| EditAction     | Domain | User decision (accept, skip, modify) on a suggestion         |
| EditSequence   | Domain | Ordered collection of related edits                          |

---

## Non-Functional Requirements

### Performance

- Edit suggestions: < 3 seconds for 1000 files
- Session restore: < 1 second
- Memory usage: < 100MB for typical session

### Security

- No code is sent to external services without user consent
- Edit history is stored locally by default
- Sensitive patterns can be excluded

### Accessibility

- Keyboard navigation for all actions
- Screen reader compatible
- High contrast mode support

### Compatibility

- VS Code 1.70+
- Git integration
- Works with all supported languages

---

## Assumptions

1. Users have indexed codebase for context awareness
2. Edit suggestions are based on semantic analysis, not just text matching
3. The feature works best with well-structured, consistent codebases
4. Users have basic familiarity with refactoring concepts
5. Network connectivity is required for first analysis

---

## Dependencies

### Internal Dependencies

- Codebase indexing service
- Chat interface
- Edit/ApplyDiff tools
- Version control integration

### External Dependencies

- GitHub API (for diff preview)
- Language servers (for semantic analysis)

---

## Out of Scope

1. **Auto-fix without review**: Users must review all edits
2. **Cross-repository edits**: Initial version is single repository
3. **Real-time collaboration**: Future enhancement
4. **Custom edit patterns**: Initial version uses AI suggestions
5. **IDE-specific optimizations**: Universal implementation first

---

## Risks and Mitigations

| Risk                  | Impact | Likelihood | Mitigation                             |
| --------------------- | ------ | ---------- | -------------------------------------- |
| Poor edit suggestions | High   | Medium     | Highlighting, easy skip, user feedback |
| Performance issues    | Medium | Low        | Caching, incremental analysis          |
| User confusion        | Medium | Medium     | Clear UI, onboarding tutorial          |
| Missing locations     | High   | Low        | Multiple analysis passes, user review  |

---

## Open Questions

[NEEDS CLARIFICATION: Should Next Edit support undo at the file level or edit level?]

- **RESOLVED**: Both levels available - File level for bulk undo, edit level for granular control

[NEEDS CLARIFICATION: Should edits be applied automatically to git staging?]

- Option A: Applied directly to working directory
- Option B: Staged automatically
- Option C: User chooses per session

---

## UI/UX Design

### User Flow

```
1. User selects "Start Next Edit" from chat
2. User describes the edit goal
3. System analyzes and shows first edit
4. User reviews, modifies, accepts/skip
5. System moves to next edit
6. ...continues until complete
7. Summary screen shows all changes
```

### Key Screens

1. **Session Start Dialog**: Describe edit goal
2. **Edit Review Panel**: Shows diff, context, actions
3. **Progress Indicator**: Current/total, skipped count
4. **Summary View**: All applied changes

### Keyboard Shortcuts

- `Ctrl+Enter`: Accept edit
- `Ctrl+Shift+Enter`: Skip edit
- `Ctrl+E`: Edit suggestion manually
- `Ctrl+Z`: Undo last edit
- `Ctrl+→`: Next edit
- `Ctrl+←`: Previous edit

---

## Implementation Hints

### Architecture

```
src/
├── features/
│   └── next-edit/
│       ├── NextEditSession.ts    # Session management
│       ├── EditAnalyzer.ts       # Find edit locations
│       ├── EditPresenter.ts      # Present edits to user
│       └── EditExecutor.ts       # Apply edits
├── webview-ui/
│   └── components/
│       └── NextEditPanel.tsx     # Edit review UI
```

### Key APIs

```typescript
interface NextEditSession {
	id: string
	goal: string
	status: "active" | "completed" | "cancelled"
	edits: EditSuggestion[]
	progress: { current: number; total: number }

	start(): Promise<void>
	getNextEdit(): EditSuggestion | null
	applyEdit(editId: string, modification?: string): Promise<void>
	skipEdit(editId: string): Promise<void>
	undoLastEdit(): Promise<void>
	complete(): Promise<void>
}
```

---

## Revision History

| Version | Date       | Author    | Changes               |
| ------- | ---------- | --------- | --------------------- |
| 1.0     | 2026-01-13 | Kilo Code | Initial specification |

---

## Approval Status

| Role          | Name | Status  | Date |
| ------------- | ---- | ------- | ---- |
| Product Owner | TBD  | Pending | -    |
| Tech Lead     | TBD  | Pending | -    |
| Designer      | TBD  | Pending | -    |
