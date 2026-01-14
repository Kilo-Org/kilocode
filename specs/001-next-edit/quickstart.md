# Quickstart Guide: Next Edit Feature

**Feature**: Next Edit  
**Date**: 2026-01-13  
**Phase**: 1 - Design & Contracts

## Overview

This guide provides a quick reference for developers implementing the Next Edit feature. It covers the core concepts, API usage, and common workflows.

## Core Concepts

### Session

A **session** represents a single Next Edit workflow with a sequence of edits. Each session has:

- A unique ID (UUID)
- A user-defined goal (e.g., "Rename function `oldName` to `newName`")
- A collection of edit suggestions
- Progress tracking

### Edit Suggestion

An **edit suggestion** is a single proposed change to a file, including:

- File path and line numbers
- Original and suggested content
- Rationale for the change
- Confidence score (0-1)
- Dependencies on other edits

### Edit Sequence

Edits are presented in a logical sequence based on:

- Dependencies (dependent edits must be processed first)
- Priority (higher priority edits appear first)
- File grouping (edits in the same file are grouped together)

## Quick Start

### 1. Starting a Session

```typescript
import { NextEditSession } from "./services/next-edit/NextEditSession"

const session = new NextEditSession({
	goal: "Rename function `oldName` to `newName`",
	workspaceUri: vscode.workspace.workspaceFolders[0].uri.toString(),
	options: {
		includePatterns: ["**/*.ts", "**/*.tsx"],
		excludePatterns: ["**/node_modules/**", "**/dist/**"],
		maxFiles: 1000,
	},
})

await session.start()
```

### 2. Getting the Next Edit

```typescript
const edit = session.getNextEdit()
if (edit) {
	console.log(`Edit ${edit.id}: ${edit.filePath}:${edit.lineStart}`)
	console.log(`Rationale: ${edit.rationale}`)
	console.log(`Confidence: ${edit.confidence}`)
}
```

### 3. Accepting an Edit

```typescript
await session.applyEdit(edit.id)
// Or with modification
await session.applyEdit(edit.id, "modified content here")
```

### 4. Skipping an Edit

```typescript
await session.skipEdit(edit.id, "Not applicable to this file")
```

### 5. Undoing an Edit

```typescript
// Undo last edit
await session.undoLastEdit()

// Undo all edits in a file
await session.undoLastEdit("file")

// Undo all edits in session
await session.undoLastEdit("all")
```

## API Reference

### Session Lifecycle

```typescript
interface NextEditSession {
	// Start a new session
	start(): Promise<void>

	// Get next edit in sequence
	getNextEdit(): EditSuggestion | null

	// Apply an edit (with optional modification)
	applyEdit(editId: string, modification?: string): Promise<void>

	// Skip an edit
	skipEdit(editId: string, reason?: string): Promise<void>

	// Undo last edit
	undoLastEdit(level?: "edit" | "file" | "all"): Promise<void>

	// Redo undone edit
	redoLastEdit(): Promise<void>

	// Pause session
	pause(): Promise<void>

	// Resume paused session
	resume(): Promise<void>

	// Cancel session
	cancel(reason?: string): Promise<void>

	// Complete session
	complete(): Promise<void>

	// Get session summary
	getSummary(): SessionSummary
}
```

### Edit Suggestion Structure

```typescript
interface EditSuggestion {
	id: string // UUID
	sessionId: string
	filePath: string // Absolute path
	lineStart: number // 1-indexed
	lineEnd: number // 1-indexed
	originalContent: string
	suggestedContent: string
	rationale: string // Why this edit is suggested
	confidence: number // 0-1
	dependencies: string[] // Edit IDs that must be applied first
	dependents: string[] // Edit IDs that depend on this
	status: EditStatus
	userModification?: string // User's modified version
	language: string
	category: EditCategory
	priority: number // Higher = earlier in sequence
}
```

## Common Workflows

### Workflow 1: Simple Refactor

```typescript
// 1. Start session
const session = new NextEditSession({
	goal: "Rename function `oldName` to `newName`",
	workspaceUri: workspaceUri,
})
await session.start()

// 2. Process edits sequentially
let edit = session.getNextEdit()
while (edit) {
	// Review edit
	console.log(`File: ${edit.filePath}`)
	console.log(`Change: ${edit.originalContent} → ${edit.suggestedContent}`)

	// Accept edit
	await session.applyEdit(edit.id)

	// Get next edit
	edit = session.getNextEdit()
}

// 3. Complete session
await session.complete()
```

### Workflow 2: Interactive Review

```typescript
// 1. Start session
const session = new NextEditSession({
	goal: "Upgrade to new API version",
	workspaceUri: workspaceUri,
})
await session.start()

// 2. Interactive review loop
let edit = session.getNextEdit()
while (edit) {
	// Show edit to user
	const userAction = await showEditToUser(edit)

	switch (userAction) {
		case "accept":
			await session.applyEdit(edit.id)
			break
		case "modify":
			const modified = await getModifiedContent(edit)
			await session.applyEdit(edit.id, modified)
			break
		case "skip":
			await session.skipEdit(edit.id)
			break
		case "undo":
			await session.undoLastEdit()
			continue // Re-review current edit
	}

	edit = session.getNextEdit()
}

// 3. Show summary
const summary = session.getSummary()
console.log(`Completed: ${summary.completedEdits}`)
console.log(`Skipped: ${summary.skippedEdits}`)
```

### Workflow 3: Bulk Operations

```typescript
// 1. Start session
const session = new NextEditSession({
	goal: "Apply code style fixes",
	workspaceUri: workspaceUri,
})
await session.start()

// 2. Bulk accept high-confidence edits
const highConfidenceEdits = session.edits.filter((e) => e.confidence > 0.9 && e.category === EditCategory.STYLE)

for (const edit of highConfidenceEdits) {
	await session.applyEdit(edit.id)
}

// 3. Review remaining edits interactively
let edit = session.getNextEdit()
while (edit) {
	const userAction = await showEditToUser(edit)
	// ... process edit
	edit = session.getNextEdit()
}
```

## Integration Points

### VSCode Commands

Register commands in `src/activate/registerCommands.ts`:

```typescript
// kilocode_change start
vscode.commands.registerCommand("kilocode.nextEdit.start", async () => {
	const goal = await vscode.window.showInputBox({
		prompt: "Describe the edit goal",
		placeHolder: "e.g., Rename function X to Y",
	})

	if (goal) {
		const session = new NextEditSession({
			goal,
			workspaceUri: vscode.workspace.workspaceFolders[0].uri.toString(),
		})
		await session.start()
	}
})

vscode.commands.registerCommand("kilocode.nextEdit.accept", async () => {
	const session = getActiveSession()
	if (session) {
		const edit = session.getNextEdit()
		if (edit) {
			await session.applyEdit(edit.id)
		}
	}
})

vscode.commands.registerCommand("kilocode.nextEdit.skip", async () => {
	const session = getActiveSession()
	if (session) {
		const edit = session.getNextEdit()
		if (edit) {
			await session.skipEdit(edit.id)
		}
	}
})

vscode.commands.registerCommand("kilocode.nextEdit.undo", async () => {
	const session = getActiveSession()
	if (session) {
		await session.undoLastEdit()
	}
})
// kilocode_change end
```

### Webview UI Integration

Create React component in `webview-ui/src/components/NextEditPanel.tsx`:

```typescript
import { useState, useEffect } from 'react';
import { EditSuggestion, SessionStatus } from '../../shared/types';

export function NextEditPanel({ sessionId }: { sessionId: string }) {
  const [edit, setEdit] = useState<EditSuggestion | null>(null);
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.ACTIVE);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    // Load current edit
    vscode.postMessage({
      type: 'edit:next',
      payload: { sessionId }
    });
  }, [sessionId]);

  const handleAccept = () => {
    vscode.postMessage({
      type: 'edit:accept',
      payload: { sessionId, editId: edit!.id }
    });
  };

  const handleSkip = () => {
    vscode.postMessage({
      type: 'edit:skip',
      payload: { sessionId, editId: edit!.id }
    });
  };

  const handleUndo = () => {
    vscode.postMessage({
      type: 'edit:undo',
      payload: { sessionId }
    });
  };

  if (!edit) {
    return <div>No edit to review</div>;
  }

  return (
    <div className="next-edit-panel">
      <div className="progress">
        Edit {progress.current} of {progress.total}
      </div>

      <div className="edit-details">
        <h3>{edit.filePath}:{edit.lineStart}</h3>
        <p className="rationale">{edit.rationale}</p>
        <div className="confidence">
          Confidence: {Math.round(edit.confidence * 100)}%
        </div>

        <div className="diff">
          {/* Show diff of original vs suggested */}
        </div>
      </div>

      <div className="actions">
        <button onClick={handleAccept}>Accept</button>
        <button onClick={handleSkip}>Skip</button>
        <button onClick={handleUndo}>Undo</button>
      </div>
    </div>
  );
}
```

## Keyboard Shortcuts

Add to `package.json`:

```json
{
	"contributes": {
		"keybindings": [
			{
				"command": "kilocode.nextEdit.accept",
				"key": "ctrl+enter",
				"mac": "cmd+enter",
				"when": "kilocode.nextEdit.active"
			},
			{
				"command": "kilocode.nextEdit.skip",
				"key": "ctrl+shift+enter",
				"mac": "cmd+shift+enter",
				"when": "kilocode.nextEdit.active"
			},
			{
				"command": "kilocode.nextEdit.undo",
				"key": "ctrl+z",
				"mac": "cmd+z",
				"when": "kilocode.nextEdit.active"
			}
		]
	}
}
```

## Testing

### Unit Tests

```typescript
import { describe, test, expect, vi } from "vitest"
import { NextEditSession } from "./NextEditSession"

describe("NextEditSession", () => {
	test("should start a session", async () => {
		const session = new NextEditSession({
			goal: "Test goal",
			workspaceUri: "/test/workspace",
		})

		await session.start()

		expect(session.status).toBe(SessionStatus.ACTIVE)
		expect(session.id).toBeDefined()
	})

	test("should apply edit", async () => {
		const session = new NextEditSession({
			goal: "Test goal",
			workspaceUri: "/test/workspace",
		})

		await session.start()
		const edit = session.getNextEdit()

		if (edit) {
			await session.applyEdit(edit.id)

			expect(session.completedEdits).toContain(edit.id)
			expect(session.undoStack.length).toBe(1)
		}
	})

	test("should undo last edit", async () => {
		const session = new NextEditSession({
			goal: "Test goal",
			workspaceUri: "/test/workspace",
		})

		await session.start()
		const edit = session.getNextEdit()

		if (edit) {
			await session.applyEdit(edit.id)
			await session.undoLastEdit()

			expect(session.completedEdits).not.toContain(edit.id)
			expect(session.redoStack.length).toBe(1)
		}
	})
})
```

### Integration Tests

```typescript
import { describe, test, expect } from "vitest"
import * as vscode from "vscode"

describe("Next Edit Integration", () => {
	test("should register commands", async () => {
		const commands = await vscode.commands.getCommands(true)

		expect(commands).toContain("kilocode.nextEdit.start")
		expect(commands).toContain("kilocode.nextEdit.accept")
		expect(commands).toContain("kilocode.nextEdit.skip")
		expect(commands).toContain("kilocode.nextEdit.undo")
	})

	test("should start session from command", async () => {
		const mockInput = "Rename function X to Y"
		vi.spyOn(vscode.window, "showInputBox").mockResolvedValue(mockInput)

		await vscode.commands.executeCommand("kilocode.nextEdit.start")

		expect(vscode.window.showInputBox).toHaveBeenCalled()
	})
})
```

## Troubleshooting

### Common Issues

**Issue**: Session fails to start

- **Cause**: Workspace not indexed or no files match patterns
- **Solution**: Check codebase indexing service, adjust include/exclude patterns

**Issue**: Edits not appearing in sequence

- **Cause**: Circular dependencies or invalid priority values
- **Solution**: Validate edit dependencies before sequencing

**Issue**: Undo not working

- **Cause**: No edits applied or undo stack empty
- **Solution**: Check session state, ensure edits were applied successfully

**Issue**: Git diff not showing

- **Cause**: Git not initialized or file not tracked
- **Solution**: Initialize git repository, ensure files are tracked

## Performance Tips

1. **Limit file count**: Use `maxFiles` option to avoid analyzing too many files
2. **Use patterns**: Provide specific include/exclude patterns to reduce scope
3. **Cache results**: Enable caching for repeated analyses
4. **Lazy load**: Load edit suggestions on-demand, not all at once
5. **Prune history**: Remove old sessions after 30 days of inactivity

## Next Steps

1. Review the full API contracts in `contracts/api.ts`
2. Study the data model in `data-model.md`
3. Read the research findings in `research.md`
4. Implement the service layer in `src/services/next-edit/`
5. Create the webview UI component
6. Write comprehensive tests
7. Update documentation

## Resources

- [VSCode Extension API](https://code.visualstudio.com/api)
- [React Documentation](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vitest Testing Guide](https://vitest.dev/guide/)
