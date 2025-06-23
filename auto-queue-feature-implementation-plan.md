# Auto-Queue Feature Implementation Plan

## Overview

This document outlines the complete implementation plan for adding an auto-queue feature to the agentic coding bot. The feature will automatically fire a new task when the current task enters an idle state (when the task stack is completely empty).

## Architecture Analysis

### Current Task Lifecycle

1. **Task Creation**: Tasks are created via `ClineProvider.initClineWithTask()`
2. **Task Stack Management**: Tasks are managed in `ClineProvider.clineStack` (LIFO stack)
3. **Task Completion**: Tasks complete via `attempt_completion` tool, emitting `taskCompleted` event
4. **Subtask Handling**: Subtasks pause parent tasks and resume them when finished
5. **Idle Detection Point**: When `clineStack.length === 0` after `removeClineFromStack()`

### Key Files Identified

- **Backend Core**: `src/core/webview/ClineProvider.ts` - Task orchestration and stack management
- **Task Lifecycle**: `src/core/task/Task.ts` - Task events and completion
- **Tool Completion**: `src/core/tools/attemptCompletionTool.ts` - Task completion logic
- **Message Handling**: `src/core/webview/webviewMessageHandler.ts` - UI-Backend communication
- **Frontend State**: `webview-ui/src/context/ExtensionStateContext.tsx` - Global state management
- **Chat Interface**: `webview-ui/src/components/chat/ChatTextArea.tsx` - User input interface

## Implementation Plan

### Phase 1: Backend Infrastructure

#### 1.1 Add Queue State to ClineProvider

**File**: `src/core/webview/ClineProvider.ts`

```typescript
export class ClineProvider extends EventEmitter<ClineProviderEvents> implements vscode.WebviewViewProvider {
	// Add new properties
	private queuedPrompt: string | null = null
	private autoQueueEnabled: boolean = false
	private isProcessingQueue: boolean = false // Prevent race conditions

	// Add queue management methods
	public setQueuedPrompt(prompt: string | null): void {
		this.queuedPrompt = prompt
		this.log(`[auto-queue] Queued prompt ${prompt ? "set" : "cleared"}: ${prompt?.substring(0, 50)}...`)
		this.postStateToWebview() // Update UI
	}

	public getQueuedPrompt(): string | null {
		return this.queuedPrompt
	}

	public setAutoQueueEnabled(enabled: boolean): void {
		this.autoQueueEnabled = enabled
		this.log(`[auto-queue] Auto-queue ${enabled ? "enabled" : "disabled"}`)
		this.postStateToWebview()
	}

	public getAutoQueueEnabled(): boolean {
		return this.autoQueueEnabled
	}

	// Add idle state detection
	private async handleIdleState(): Promise<void> {
		this.log(`[auto-queue] Handling idle state - stack empty, checking queue...`)

		if (!this.autoQueueEnabled) {
			this.log(`[auto-queue] Auto-queue disabled, not processing`)
			return
		}

		if (!this.queuedPrompt) {
			this.log(`[auto-queue] No queued prompt, remaining idle`)
			return
		}

		if (this.isProcessingQueue) {
			this.log(`[auto-queue] Already processing queue, skipping`)
			return
		}

		const promptToExecute = this.queuedPrompt
		this.queuedPrompt = null // Clear queue before execution
		this.isProcessingQueue = true

		this.log(`[auto-queue] Executing queued prompt: ${promptToExecute.substring(0, 100)}...`)

		try {
			// Small delay to ensure UI updates and prevent race conditions
			setTimeout(async () => {
				try {
					await this.initClineWithTask(promptToExecute)
					this.log(`[auto-queue] Successfully started queued task`)
				} catch (error) {
					this.log(`[auto-queue] Error starting queued task: ${error}`)
					// Optionally re-queue the prompt on error
					this.queuedPrompt = promptToExecute
				} finally {
					this.isProcessingQueue = false
					await this.postStateToWebview()
				}
			}, 1000) // 1 second delay for stability
		} catch (error) {
			this.log(`[auto-queue] Error in handleIdleState: ${error}`)
			this.isProcessingQueue = false
		}
	}
}
```

#### 1.2 Modify Task Stack Management

**File**: `src/core/webview/ClineProvider.ts`

```typescript
// Modify existing removeClineFromStack method
async removeClineFromStack() {
    if (this.clineStack.length === 0) {
        return
    }

    // ... existing logic ...

    // After removing from stack, check if we're now completely idle
    if (this.clineStack.length === 0) {
        this.log(`[auto-queue] Task stack is now empty - checking for auto-queue`)
        await this.handleIdleState()
    }
}

// Also modify finishSubTask to ensure proper idle detection
async finishSubTask(lastMessage: string) {
    console.log(`[subtasks] finishing subtask ${lastMessage}`)
    await this.removeClineFromStack()

    // Check if parent task exists to resume
    const currentTask = this.getCurrentCline()
    if (currentTask) {
        await currentTask.resumePausedTask(lastMessage)
    } else {
        // No parent task - we're truly idle
        this.log(`[auto-queue] No parent task to resume - checking idle state`)
        await this.handleIdleState()
    }
}
```

#### 1.3 Update State Management

**File**: `src/core/webview/ClineProvider.ts`

```typescript
// Add to getStateToPostToWebview method
async getStateToPostToWebview() {
    // ... existing state ...

    return {
        // ... existing properties ...
        queuedPrompt: this.queuedPrompt,
        autoQueueEnabled: this.autoQueueEnabled,
        isProcessingQueue: this.isProcessingQueue,
    }
}

// Add to getState method
async getState() {
    // ... existing state ...

    return {
        // ... existing properties ...
        queuedPrompt: this.queuedPrompt,
        autoQueueEnabled: this.autoQueueEnabled,
        isProcessingQueue: this.isProcessingQueue,
    }
}
```

### Phase 2: Message Handler Integration

#### 2.1 Add Queue Message Handlers

**File**: `src/core/webview/webviewMessageHandler.ts`

```typescript
export const webviewMessageHandler = async (provider: ClineProvider, message: WebviewMessage) => {
	// ... existing switch cases ...

	switch (message.type) {
		// ... existing cases ...

		case "setQueuedPrompt":
			provider.setQueuedPrompt(message.prompt)
			break

		case "clearQueuedPrompt":
			provider.setQueuedPrompt(null)
			break

		case "setAutoQueueEnabled":
			provider.setAutoQueueEnabled(message.enabled)
			break

		case "getQueueState":
			await provider.postStateToWebview()
			break
	}
}
```

#### 2.2 Update WebviewMessage Types

**File**: `src/shared/WebviewMessage.ts`

```typescript
export type WebviewMessage =
	// ... existing message types ...
	| {
			type: "setQueuedPrompt"
			prompt: string | null
	  }
	| {
			type: "clearQueuedPrompt"
	  }
	| {
			type: "setAutoQueueEnabled"
			enabled: boolean
	  }
	| {
			type: "getQueueState"
	  }
```

### Phase 3: Frontend State Management

#### 3.1 Update Extension State Context

**File**: `webview-ui/src/context/ExtensionStateContext.tsx`

```typescript
interface ExtensionState {
	// ... existing properties ...
	queuedPrompt: string | null
	autoQueueEnabled: boolean
	isProcessingQueue: boolean
}

interface ExtensionStateContextType extends ExtensionState {
	// ... existing methods ...
	setQueuedPrompt: (prompt: string | null) => void
	setAutoQueueEnabled: (enabled: boolean) => void
}

// Add to default state
const defaultState: ExtensionState = {
	// ... existing defaults ...
	queuedPrompt: null,
	autoQueueEnabled: false,
	isProcessingQueue: false,
}

// Add to context value
const contextValue: ExtensionStateContextType = {
	// ... existing properties ...
	queuedPrompt: state.queuedPrompt,
	autoQueueEnabled: state.autoQueueEnabled,
	isProcessingQueue: state.isProcessingQueue,

	// ... existing methods ...
	setQueuedPrompt: (prompt) => {
		setState((prev) => ({ ...prev, queuedPrompt: prompt }))
		vscode.postMessage({ type: "setQueuedPrompt", prompt })
	},
	setAutoQueueEnabled: (enabled) => {
		setState((prev) => ({ ...prev, autoQueueEnabled: enabled }))
		vscode.postMessage({ type: "setAutoQueueEnabled", enabled })
	},
}
```

### Phase 4: UI Components

#### 4.1 Create Queue Management Component

**File**: `webview-ui/src/components/chat/QueueManager.tsx`

```typescript
import React, { useState } from 'react'
import { VSCodeButton, VSCodeTextField, VSCodeCheckbox } from '@vscode/webview-ui-toolkit/react'
import { useExtensionState } from '@src/context/ExtensionStateContext'
import { useAppTranslation } from '@src/i18n/TranslationContext'

interface QueueManagerProps {
    className?: string
}

export const QueueManager: React.FC<QueueManagerProps> = ({ className }) => {
    const { t } = useAppTranslation()
    const {
        queuedPrompt,
        autoQueueEnabled,
        isProcessingQueue,
        setQueuedPrompt,
        setAutoQueueEnabled
    } = useExtensionState()

    const [tempPrompt, setTempPrompt] = useState(queuedPrompt || '')
    const [isExpanded, setIsExpanded] = useState(false)

    const handleSetQueue = () => {
        if (tempPrompt.trim()) {
            setQueuedPrompt(tempPrompt.trim())
            setIsExpanded(false)
        }
    }

    const handleClearQueue = () => {
        setQueuedPrompt(null)
        setTempPrompt('')
        setIsExpanded(false)
    }

    const hasQueuedPrompt = !!queuedPrompt

    return (
        <div className={`queue-manager ${className || ''}`}>
            {/* Queue Status Indicator */}
            <div className="flex items-center gap-2 p-2 bg-vscode-editor-background border border-vscode-editorGroup-border rounded">
                <VSCodeCheckbox
                    checked={autoQueueEnabled}
                    onChange={(e: any) => setAutoQueueEnabled(e.target.checked)}
                    disabled={isProcessingQueue}
                >
                    Auto-Queue
                </VSCodeCheckbox>

                {hasQueuedPrompt && (
                    <div className="flex items-center gap-2 flex-1">
                        <span className="codicon codicon-clock text-vscode-descriptionForeground" />
                        <span className="text-sm text-vscode-descriptionForeground truncate">
                            Queued: {queuedPrompt.substring(0, 50)}...
                        </span>
                        <VSCodeButton
                            appearance="icon"
                            onClick={handleClearQueue}
                            disabled={isProcessingQueue}
                        >
                            <span className="codicon codicon-close" />
                        </VSCodeButton>
                    </div>
                )}

                {!hasQueuedPrompt && (
                    <VSCodeButton
                        appearance="secondary"
                        onClick={() => setIsExpanded(!isExpanded)}
                        disabled={isProcessingQueue}
                    >
                        <span className="codicon codicon-add" />
                        Set Queue
                    </VSCodeButton>
                )}

                {isProcessingQueue && (
                    <div className="flex items-center gap-1">
                        <span className="codicon codicon-loading codicon-modifier-spin" />
                        <span className="text-sm text-vscode-descriptionForeground">
                            Processing...
                        </span>
                    </div>
                )}
            </div>

            {/* Queue Input (Expanded) */}
            {isExpanded && (
                <div className="mt-2 p-3 bg-vscode-editor-background border border-vscode-editorGroup-border rounded">
                    <div className="mb-2">
                        <label className="block text-sm font-medium mb-1">
                            Queue Prompt:
                        </label>
                        <VSCodeTextField
                            value={tempPrompt}
                            onInput={(e: any) => setTempPrompt(e.target.value)}
                            placeholder="Enter the prompt to execute when tasks complete..."
                            className="w-full"
                        />
                    </div>
                    <div className="flex gap-2">
                        <VSCodeButton
                            onClick={handleSetQueue}
                            disabled={!tempPrompt.trim()}
                        >
                            Set Queue
                        </VSCodeButton>
                        <VSCodeButton
                            appearance="secondary"
                            onClick={() => setIsExpanded(false)}
                        >
                            Cancel
                        </VSCodeButton>
                    </div>
                </div>
            )}
        </div>
    )
}
```

#### 4.2 Integrate Queue Manager into Chat Interface

**File**: `webview-ui/src/components/chat/ChatTextArea.tsx`

```typescript
import { QueueManager } from './QueueManager'

// Add to the ChatTextArea component, positioned above the input area
export default function ChatTextArea({ ... }) {
    // ... existing code ...

    return (
        <div className="chat-textarea-container">
            {/* Add Queue Manager above the input */}
            <QueueManager className="mb-2" />

            {/* Existing chat input area */}
            <div className="relative">
                {/* ... existing input components ... */}
            </div>
        </div>
    )
}
```

### Phase 5: Safety and Error Handling

#### 5.1 Add Safeguards

**File**: `src/core/webview/ClineProvider.ts`

```typescript
// Add queue execution limits to prevent infinite loops
private queueExecutionCount: number = 0
private readonly MAX_QUEUE_EXECUTIONS = 10 // Prevent infinite loops
private lastQueueExecutionTime: number = 0
private readonly MIN_QUEUE_INTERVAL = 5000 // 5 seconds minimum between executions

private async handleIdleState(): Promise<void> {
    // ... existing checks ...

    // Safety check: prevent too many rapid executions
    const now = Date.now()
    if (now - this.lastQueueExecutionTime < this.MIN_QUEUE_INTERVAL) {
        this.log(`[auto-queue] Too soon since last execution, waiting...`)
        return
    }

    // Safety check: prevent infinite loops
    if (this.queueExecutionCount >= this.MAX_QUEUE_EXECUTIONS) {
        this.log(`[auto-queue] Max executions reached (${this.MAX_QUEUE_EXECUTIONS}), disabling auto-queue`)
        this.autoQueueEnabled = false
        await this.postStateToWebview()
        return
    }

    // ... existing execution logic ...

    this.queueExecutionCount++
    this.lastQueueExecutionTime = now

    // Reset counter after successful execution with delay
    setTimeout(() => {
        this.queueExecutionCount = Math.max(0, this.queueExecutionCount - 1)
    }, 60000) // Reset one count per minute
}
```

#### 5.2 Add Error Recovery

**File**: `src/core/webview/ClineProvider.ts`

```typescript
private async handleQueueError(error: Error, originalPrompt: string): Promise<void> {
    this.log(`[auto-queue] Error executing queued task: ${error.message}`)

    // Optionally re-queue the prompt with a retry count
    const retryMatch = originalPrompt.match(/\[RETRY:(\d+)\]/)
    const retryCount = retryMatch ? parseInt(retryMatch[1]) : 0

    if (retryCount < 3) { // Max 3 retries
        const retryPrompt = `[RETRY:${retryCount + 1}] ${originalPrompt.replace(/\[RETRY:\d+\]\s*/, '')}`
        this.queuedPrompt = retryPrompt
        this.log(`[auto-queue] Re-queued with retry count: ${retryCount + 1}`)
    } else {
        this.log(`[auto-queue] Max retries reached, not re-queuing`)
        this.autoQueueEnabled = false // Disable to prevent further issues
    }

    await this.postStateToWebview()
}
```

### Phase 6: Testing Strategy

#### 6.1 Unit Tests

Create tests for:

- Idle state detection logic
- Queue management methods
- Safety mechanisms (rate limiting, max executions)
- Error handling and recovery

#### 6.2 Integration Tests

Test scenarios:

- Single task completion → queue execution
- Subtask completion → parent task resume (no queue execution)
- Multiple nested subtasks → final completion → queue execution
- Queue execution failure → error handling
- Rapid task completions → rate limiting

#### 6.3 Manual Testing Checklist

- [ ] Set a queued prompt and complete a task
- [ ] Verify queue executes automatically
- [ ] Test with nested subtasks
- [ ] Test error scenarios (invalid prompts, API failures)
- [ ] Test UI state synchronization
- [ ] Test safety mechanisms (rate limiting, max executions)
- [ ] Test queue clearing and disabling

### Phase 7: Documentation and Logging

#### 7.1 Add Comprehensive Logging

All queue operations should be logged with `[auto-queue]` prefix for easy debugging:

- Queue state changes
- Idle state detection
- Queue execution attempts
- Errors and recovery
- Safety mechanism triggers

#### 7.2 User Documentation

Add documentation explaining:

- How to use the auto-queue feature
- Safety mechanisms and limitations
- Troubleshooting common issues

## Implementation Timeline

1. **Week 1**: Backend infrastructure (Phase 1-2)
2. **Week 2**: Frontend components (Phase 3-4)
3. **Week 3**: Safety mechanisms and testing (Phase 5-6)
4. **Week 4**: Documentation and polish (Phase 7)

## Risk Assessment

### Low Risk

- Idle state detection (clear insertion point)
- UI integration (existing patterns)
- State management (established system)

### Medium Risk

- Race conditions between task completion and queue execution
- Proper handling of nested subtasks
- UI state synchronization

### Mitigation Strategies

- Extensive logging for debugging
- Safety mechanisms (rate limiting, max executions)
- Comprehensive testing of edge cases
- Gradual rollout with feature flags

## Success Criteria

1. ✅ Detect true idle state (empty task stack)
2. ✅ Store and manage queued prompts
3. ✅ Automatically execute queued prompts on idle
4. ✅ Prevent infinite loops and race conditions
5. ✅ Provide intuitive UI for queue management
6. ✅ Handle errors gracefully
7. ✅ Maintain system stability

This implementation plan provides a comprehensive roadmap for adding the auto-queue feature while maintaining system reliability and user experience.
