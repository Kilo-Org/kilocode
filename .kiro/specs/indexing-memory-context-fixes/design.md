# Design Document: Indexing, Memory & Context Fixes

## Overview

هذا التصميم يحدد كيفية إصلاح وتكامل نظام Indexing و Memory و Context في Kilo Code. الهدف الرئيسي هو إصلاح 53+ خطأ TypeScript وتكامل الخدمات غير المتصلة.

## Architecture

### Current State (المشاكل الحالية)

```
┌─────────────────────────────────────────────────────────────┐
│                      extension.ts                            │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ CodeIndexManager│  │ ManagedIndexer  │  ✅ متكامل        │
│  └─────────────────┘  └─────────────────┘                   │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Multi-File Diff System (غير متكامل ❌)                  ││
│  │  - MemoryManagementService                              ││
│  │  - SessionStateManager                                   ││
│  │  - BackgroundProcessingService                          ││
│  │  - PerformanceMonitoringService                         ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Target State (الحالة المستهدفة)

```
┌─────────────────────────────────────────────────────────────┐
│                      extension.ts                            │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ CodeIndexManager│  │ ManagedIndexer  │                   │
│  └────────┬────────┘  └─────────────────┘                   │
│           │                                                  │
│           ▼                                                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Multi-File Diff System (متكامل ✅)                      ││
│  │  ┌───────────────────┐  ┌────────────────────┐          ││
│  │  │MemoryManagement   │◄─┤ CodeIndexManager   │          ││
│  │  │Service            │  │ (uses for tracking)│          ││
│  │  └───────────────────┘  └────────────────────┘          ││
│  │  ┌───────────────────┐  ┌────────────────────┐          ││
│  │  │Performance        │  │ Background         │          ││
│  │  │MonitoringService  │  │ ProcessingService  │          ││
│  │  └───────────────────┘  └────────────────────┘          ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Type Consolidation Strategy

**المشكلة:** الأنواع مكررة في ملفين:

- `src/types/diff-types.ts` - يحتوي على SessionState, FileState, SessionSettings
- `src/types/session-types.ts` - يحتوي على نفس الأنواع

**الحل:**

```typescript
// src/types/session-types.ts - المصدر الرئيسي
export interface SessionState { ... }
export interface FileState { ... }
export interface SessionSettings { ... }

// src/types/diff-types.ts - إعادة التصدير
export { SessionState, FileState, SessionSettings } from './session-types';
// + الأنواع الخاصة بالـ Diff فقط
export interface DiffOverlay { ... }
export interface FileBuffer { ... }
```

### 2. Import Path Fixes

**الملفات المتأثرة والإصلاحات:**

| File                           | Current Import           | Fixed Import                |
| ------------------------------ | ------------------------ | --------------------------- |
| `src/services/event-system.ts` | `../../types/diff-types` | `../types/diff-types`       |
| `src/ui/diff-renderer.ts`      | `../../types/diff-types` | `../types/diff-types`       |
| `src/ui/interaction-layer.ts`  | `../../types/diff-types` | `../types/diff-types`       |
| `src/ui/diff-renderer.ts`      | `../error-handler`       | `../services/error-handler` |
| `src/ui/interaction-layer.ts`  | `../error-handler`       | `../services/error-handler` |

### 3. FileOpenerService Fixes

**المشكلة:** استخدام أنواع VSCode خاطئة

```typescript
// قبل (خطأ)
private onVisibleEditorsChanged(event: vscode.TextEditor[]): void

// بعد (صحيح)
private onVisibleEditorsChanged(editors: readonly vscode.TextEditor[]): void
```

```typescript
// قبل (خطأ)
private onActiveEditorChanged(event: vscode.TextEditorChangeEvent): void

// بعد (صحيح)
private onActiveEditorChanged(editor: vscode.TextEditor | undefined): void
```

### 4. DiffEngine Fixes

**المشكلة:** استخدام await في دالة غير async

```typescript
// قبل (خطأ)
private processChunk(chunk: string): DiffResult {
  const result = await this.parser.parse(chunk); // ❌
}

// بعد (صحيح)
private async processChunk(chunk: string): Promise<DiffResult> {
  const result = await this.parser.parse(chunk); // ✅
}
```

### 5. Multi-File Diff System Integration

**التكامل في extension.ts:**

```typescript
// في activate()
import { initializeMultiFileDiffSystem } from "./multi-file-diff-system"

// بعد تهيئة CodeIndexManager
try {
	await initializeMultiFileDiffSystem(context)
	outputChannel.appendLine("[MultiFileDiff] System initialized successfully")
} catch (error) {
	outputChannel.appendLine(
		`[MultiFileDiff] Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
	)
	// Continue with other services - non-critical
}
```

### 6. Memory Management Integration with CodeIndexManager

```typescript
// في CodeIndexOrchestrator
import { MemoryManagementService } from '../performance/memory-management';

public async startIndexing(): Promise<void> {
  const memoryManager = MemoryManagementService.getInstance();

  // Check memory before starting
  const canStart = memoryManager.startOperation('indexing', estimatedMemory);
  if (!canStart) {
    this.stateManager.setSystemState('Error', 'Insufficient memory for indexing');
    return;
  }

  try {
    // ... existing indexing logic
  } finally {
    memoryManager.endOperation('indexing');
  }
}
```

## Data Models

### Consolidated Type Definitions

```typescript
// src/types/session-types.ts (المصدر الرئيسي)
export interface SessionState {
	id: string
	activeShadowBuffers: string[]
	fileStates: Map<string, FileState>
	globalSettings: SessionSettings
	createdAt: Date
	lastActivity: Date
}

export interface FileState {
	filePath: string
	hasUnsavedChanges: boolean
	activeDiffCount: number
	lastSyncVersion: number
}

export interface SessionSettings {
	autoSave: boolean
	diffColorScheme: "vscode" | "custom" | "high-contrast"
	maxFileSize: number
	streamingChunkSize?: number
}
```

## Correctness Properties

_A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees._

### Property 1: Service Initialization Completeness

_For any_ extension activation, all registered services (MemoryManagementService, PerformanceMonitoringService, BackgroundProcessingService) should be initialized, and if any fails, the error should be logged and other services should continue initializing.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4**

### Property 2: Memory Management Integration

_For any_ indexing operation started by CodeIndexManager, the MemoryManagementService should track the operation, emit warnings when thresholds are exceeded, and limit concurrent operations based on available memory.

**Validates: Requirements 8.1, 8.2, 8.3, 8.4**

### Property 3: Event System Correctness

_For any_ event emitted by DiffEventManager, all registered listeners should receive the event with correct type and data, and the system should handle all defined event types.

**Validates: Requirements 7.2, 7.3**

### Property 4: Type Compilation Correctness

_For any_ TypeScript file in the codebase, running `pnpm check-types` should produce zero errors related to type resolution, module paths, or API signatures.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 3.1, 3.2, 3.3, 3.4, 5.1, 5.2, 6.1, 6.2, 6.3, 6.4, 7.1**

### Property 5: Backward Compatibility

_For any_ existing functionality that uses CodeIndexManager, VisibleCodeTracker, or FileContextTracker, the changes should not break existing behavior or APIs.

**Validates: Requirements 9.3**

## Error Handling

### Initialization Errors

```typescript
try {
	await initializeMultiFileDiffSystem(context)
} catch (error) {
	// Log error but don't crash extension
	Logger.error("MultiFileDiff", "Initialization failed", error)
	// Services will be unavailable but extension continues
}
```

### Memory Threshold Errors

```typescript
if (currentMemory.percentage >= criticalThreshold) {
	// Emit event for UI notification
	this.emitEvent({
		type: "memory_critical",
		message: "Critical memory usage - operations may be limited",
	})
	// Attempt garbage collection
	this.forceGarbageCollection()
	// Reject new operations
	return false
}
```

### Type Resolution Errors

All type resolution errors will be fixed at compile time. No runtime handling needed.

## Testing Strategy

### Unit Tests

1. **Type Compilation Test**: Run `pnpm check-types` and verify 0 errors
2. **Service Initialization Test**: Mock VSCode context and verify all services initialize
3. **Memory Threshold Test**: Simulate memory conditions and verify correct behavior

### Property-Based Tests

Using the project's existing test framework (vitest), we will implement property-based tests for:

1. **Service Initialization**: Generate random initialization orders and verify all services start
2. **Memory Management**: Generate random memory states and verify correct threshold handling
3. **Event System**: Generate random events and verify correct delivery

### Integration Tests

1. **Extension Activation**: Full activation test with all services
2. **Indexing with Memory Tracking**: Index a workspace and verify memory tracking
3. **Diff Operations**: Create diffs and verify correct handling

## Implementation Order

1. **Phase 1: Type Fixes** (إصلاح الأنواع)

    - Consolidate type definitions
    - Fix import paths
    - Fix VSCode API signatures

2. **Phase 2: Service Fixes** (إصلاح الخدمات)

    - Fix DiffEngine async issues
    - Fix FileOpenerService types
    - Fix UI component imports

3. **Phase 3: Integration** (التكامل)

    - Integrate Multi-File Diff System with extension
    - Integrate MemoryManagementService with CodeIndexManager

4. **Phase 4: Testing** (الاختبار)
    - Run type checks
    - Run unit tests
    - Run integration tests
