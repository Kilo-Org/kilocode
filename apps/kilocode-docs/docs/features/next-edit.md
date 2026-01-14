# Next Edit Feature

Next Edit is a streamlined codebase editing workflow that helps you make systematic changes across your project with AI-powered analysis, intelligent edit sequencing, and step-by-step review capabilities.

## Overview

Next Edit provides a structured approach to making multiple code changes:

- **AI-Powered Analysis**: Automatically identifies locations in your codebase that need editing based on your goals
- **Intelligent Sequencing**: Orders edits based on dependencies to ensure correct application order
- **Step-by-Step Review**: Review each edit individually with diff view and context information
- **Undo/Redo Support**: Full undo/redo capabilities at edit, file, and session levels
- **Session Management**: Save, pause, resume, and track progress of editing sessions

## Getting Started

### Starting a Next Edit Session

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Run the `Next Edit: Start Session` command
3. Enter your editing goal (e.g., "Add TypeScript types to all functions")
4. Optionally configure:

    - **Include Patterns**: File patterns to include (e.g., `*.ts,*.tsx`)
    - **Exclude Patterns**: File patterns to exclude (e.g., `node_modules/**,dist/**`)
    - **Max Files**: Maximum number of files to analyze

5. Click "Start Session" to begin analysis

### Reviewing Edits

Once analysis completes, the Next Edit panel appears showing:

- **Current Edit**: The edit being reviewed with:

    - File path
    - Rationale (why this edit is suggested)
    - Diff view showing original vs. suggested code
    - Context information (surrounding code, imports, exports)

- **Progress Bar**: Visual indicator of session progress
- **Action Buttons**:
    - **Accept** (Ctrl+Enter): Apply the edit
    - **Skip** (Ctrl+Shift+Enter): Skip this edit
    - **Undo** (Ctrl+Z): Undo the last applied edit

### Keyboard Shortcuts

| Shortcut           | Action              |
| ------------------ | ------------------- |
| `Ctrl+Enter`       | Accept current edit |
| `Ctrl+Shift+Enter` | Skip current edit   |
| `Ctrl+Z`           | Undo last edit      |
| `Escape`           | Close panel         |

## Workflow

### 1. Analysis Phase

The EditAnalyzer service examines your codebase using:

- **Semantic Analysis**: Leverages language server APIs for deep code understanding
- **Pattern Matching**: Uses regex patterns to identify common code issues
- **Hybrid Approach**: Combines both methods for comprehensive coverage

Results are cached for 10 minutes to improve performance on repeated analyses.

### 2. Sequencing Phase

The EditSequencer service orders edits to ensure correct application:

- **Dependency Resolution**: Identifies dependencies between edits
- **Topological Sorting**: Orders edits based on dependency graph
- **Circular Dependency Detection**: Warns about potential issues
- **Sequence Grouping**: Groups independent edits for efficiency

### 3. Execution Phase

The EditExecutor service applies changes with full tracking:

- **File Operations**: Reads and writes files using VSCode API
- **Diff Generation**: Creates unified diffs for review
- **Undo/Redo Stacks**: Maintains history for each session
- **Git Integration**: Provides git diff preview

### 4. Session Management

The NextEditSession service orchestrates the entire workflow:

- **Session Persistence**: Saves session state to workspace storage
- **Progress Tracking**: Monitors completion, skipped, and remaining edits
- **Status Management**: Handles active, paused, completed, and cancelled states
- **Summary Generation**: Provides detailed session summaries

## Session States

| State       | Description                             |
| ----------- | --------------------------------------- |
| `Active`    | Session is currently in progress        |
| `Paused`    | Session paused by user (can be resumed) |
| `Completed` | All edits processed                     |
| `Cancelled` | Session cancelled by user               |

## Edit Status

| Status     | Description               |
| ---------- | ------------------------- |
| `Pending`  | Edit awaiting review      |
| `Accepted` | Edit applied successfully |
| `Skipped`  | Edit skipped by user      |
| `Error`    | Edit application failed   |

## API Reference

### Services

#### EditAnalyzer

Analyzes codebase to identify edit locations.

```typescript
interface IEditAnalyzer {
	analyzeCodebase(workspaceUri: string, goal: string, options?: AnalysisOptions): Promise<AnalysisResult>
	generateEditSuggestions(analysisData: unknown, sessionId: string): Promise<EditSuggestion[]>
	calculateConfidence(edit: EditSuggestion): number
	generateContext(edit: EditSuggestion, fileContent: string): Promise<EditContext>
}
```

#### EditSequencer

Orders edits based on dependencies.

```typescript
interface IEditSequencer {
	sequenceEdits(edits: EditSuggestion[]): Promise<SequencingResult>
	resolveDependencies(edits: EditSuggestion[]): Promise<Map<string, string[]>>
	detectCircularDependencies(edits: EditSuggestion[]): Array<CircularDependency>
	generateSequences(edits: EditSuggestion[], sessionId: string): Promise<EditSequence[]>
	validateDependenciesMet(edit: EditSuggestion, completedEditIds: string[]): boolean
}
```

#### EditExecutor

Applies edits with undo/redo support.

```typescript
interface IEditExecutor {
	applyEdit(edit: EditSuggestion, modification?: string): Promise<ApplyEditResult>
	generateDiff(edit: EditSuggestion): string
	bulkApplyEdits(edits: EditSuggestion[]): Promise<BulkApplyResult>
	undoLastEdit(sessionId: string, level?: "edit" | "file" | "all"): Promise<EditAction | null>
	redoLastEdit(sessionId: string): Promise<EditAction | null>
	getGitDiff(edit: EditSuggestion): Promise<string>
	previewAllChanges(sessionId: string): Promise<FileDiff[]>
	canUndo(sessionId: string): boolean
	canRedo(sessionId: string): boolean
}
```

#### SessionStorage

Manages session persistence.

```typescript
interface ISessionStorage {
	saveSession(session: EditSession): Promise<void>
	loadSession(sessionId: string): Promise<EditSession | null>
	deleteSession(sessionId: string): Promise<void>
	getActiveSessionId(): Promise<string | null>
	setActiveSessionId(sessionId: string): Promise<void>
	clearActiveSessionId(): Promise<void>
	listSessions(): Promise<string[]>
	getLastSessionId(): Promise<string | null>
	setLastSessionId(sessionId: string): Promise<void>
}
```

#### NextEditSession

Orchestrates the Next Edit workflow.

```typescript
interface INextEditSession {
	start(workspaceUri: string, goal: string, options?: StartOptions): Promise<EditSession>
	getNextEdit(sessionId: string): Promise<{ edit: EditSuggestion; context: EditContext }>
	applyEdit(sessionId: string, editId: string, modification?: string): Promise<EditAction>
	skipEdit(sessionId: string, editId: string, reason?: string): Promise<EditAction>
	getProgress(sessionId: string): Promise<SessionProgress>
	pause(sessionId: string): Promise<void>
	resume(sessionId: string): Promise<void>
	cancel(sessionId: string, reason?: string): Promise<void>
	complete(sessionId: string): Promise<SessionSummary>
	getSummary(sessionId: string): Promise<SessionSummary>
	undoLastEdit(sessionId: string): Promise<EditAction | null>
	redoLastEdit(sessionId: string): Promise<EditAction | null>
	getSession(sessionId: string): Promise<EditSession | null>
	listSessions(): Promise<EditSession[]>
}
```

## Example Use Cases

### Adding TypeScript Types

**Goal**: "Add TypeScript types to all functions in the codebase"

1. Start Next Edit session with goal
2. Set include patterns to `*.ts,*.tsx`
3. Review each function edit
4. Accept or skip based on preference
5. Use undo if needed to revert changes

### Refactoring Variable Names

**Goal**: "Rename all instances of `foo` to `bar`"

1. Start Next Edit session
2. Set include patterns to relevant files
3. Review each rename operation
4. Accept changes systematically
5. Preview all changes before completion

### Adding Error Handling

**Goal**: "Add try-catch blocks to all async functions"

1. Start Next Edit session with goal
2. Review each async function
3. Accept or modify error handling
4. Skip functions that already have proper error handling

## Best Practices

1. **Start Small**: Begin with focused goals on specific file patterns
2. **Review Carefully**: Always review each edit before accepting
3. **Use Undo**: Don't hesitate to undo if something goes wrong
4. **Save Sessions**: Pause long-running sessions and resume later
5. **Check Dependencies**: Pay attention to circular dependency warnings
6. **Preview Changes**: Use git diff preview before finalizing

## Performance Tips

- **Caching**: Analysis results are cached for 10 minutes
- **File Limits**: Set max files to limit analysis scope
- **Pattern Filtering**: Use include/exclude patterns to focus on relevant files
- **Incremental Edits**: Break large goals into smaller, focused sessions

## Troubleshooting

### Session Not Starting

- Ensure workspace is open in VSCode
- Check that file patterns are valid glob patterns
- Verify workspace has write permissions

### Edits Not Applying

- Check file is not read-only
- Verify file is not locked by another process
- Review error messages in the console

### Performance Issues

- Reduce max files limit
- Use more specific include patterns
- Exclude large directories like `node_modules`

## Technical Details

### Architecture

```
NextEditSession (Orchestrator)
    ├── SessionStorage (Persistence)
    ├── EditAnalyzer (Analysis)
    ├── EditSequencer (Sequencing)
    └── EditExecutor (Execution)
```

### Data Flow

1. **Start**: User provides goal → Session created
2. **Analyze**: Codebase scanned → Edit suggestions generated
3. **Sequence**: Edits ordered by dependencies
4. **Execute**: Edits applied one by one with user review
5. **Complete**: Session summary generated

### Storage

- Sessions stored in VSCode workspace state
- Each session includes: edits, progress, undo/redo stacks
- Active session ID tracked for quick resume

## Accessibility

Next Edit includes comprehensive accessibility features:

- **ARIA Labels**: All interactive elements have descriptive labels
- **Keyboard Navigation**: Full keyboard support for all actions
- **Focus Management**: Automatic focus on Accept button when edit loads
- **Screen Reader Support**: Live regions announce status changes
- **High Contrast**: Compatible with VSCode high contrast themes

## Future Enhancements

Planned improvements for Next Edit:

- **Multi-file Diff Preview**: Side-by-side diff for multiple files
- **Edit Modification**: Allow users to modify suggested edits inline
- **Batch Operations**: Accept/skip multiple edits at once
- **Custom Patterns**: Save and reuse common edit patterns
- **Export/Import**: Share sessions between workspaces
- **Integration with Git**: Commit changes directly from session completion
