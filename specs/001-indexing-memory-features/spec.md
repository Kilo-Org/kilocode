# Feature Specification: Multi-File Diff and Auto-Navigation System

**Feature Branch**: `001-indexing-memory-features`  
**Created**: January 2026  
**Status**: Implemented  
**Input**: AI-driven multi-file diff visualization and management system

## Overview

This specification documents the Multi-File Diff and Auto-Navigation System, which provides AI-driven diff visualization, file management, and session state coordination for the Kilo Code extension.

## Architecture

### Core Services

1. **FileOpenerService** (`src/services/file-management/file-opener.ts`)

    - Handles AI-driven file opening with tab management
    - Coordinates workspace file operations
    - Tracks active tabs and file buffers

2. **TabManagerService** (`src/services/file-management/tab-manager.ts`)

    - Manages multi-file tab coordination
    - Supports tab groups for organized workflows
    - Provides grid layout arrangement for multi-file viewing

3. **SessionStateManager** (`src/services/session/session-state.ts`)

    - Manages AI modification state across files
    - Uses VSCode's Memento API for persistence
    - Tracks file states and shadow buffers

4. **MultiFileStateCoordinator** (`src/services/session/multi-file-coordinator.ts`)
    - Coordinates state across multiple files
    - Handles file synchronization events

### Performance Services

5. **MemoryManagementService** (`src/services/performance/memory-management.ts`)

    - Manages memory usage for large file operations
    - Provides memory thresholds and monitoring
    - Supports operation tracking and garbage collection

6. **BackgroundProcessingService** (`src/services/performance/background-processing.ts`)

    - Handles non-blocking operations
    - Priority-based task queue
    - Supports diff processing, file operations, and memory cleanup

7. **PerformanceMonitoringService** (`src/services/performance/performance-monitoring.ts`)
    - Collects and analyzes performance metrics
    - Provides performance reports and statistics
    - Monitors processing time and memory usage

### Diff Services

8. **DiffEngine** (`src/services/diff/diff-engine.ts`)

    - Core diff functionality using the 'diff' library
    - Supports unified diff, streaming diff, and large file processing
    - Creates and applies diff overlays

9. **DiffOverlayManager** (`src/services/diff/diff-overlay.ts`)

    - Manages diff overlay visualization
    - Handles decoration rendering in VSCode

10. **StreamingDiffProcessor** (`src/services/diff/streaming-diff.ts`)
    - Processes diffs in streaming mode
    - Optimized for large files

### UI Components

11. **DiffRenderer** (`src/ui/diff-renderer.ts`)

    - Renders diff overlays in the editor
    - Manages decoration types and colors

12. **InteractionLayer** (`src/ui/interaction-layer.ts`)
    - Handles user interactions with diff overlays
    - Supports accept/reject operations
    - Provides navigation between overlays

### Infrastructure

13. **Logger & ErrorHandler** (`src/services/error-handler.ts`)

    - Centralized error handling and logging
    - VSCode output channel integration
    - Safe execution utilities with retry support

14. **DiffEventManager** (`src/services/event-system.ts`)
    - Event system for component communication
    - Supports diff, file, session, and UI events

## User Stories

### User Story 1 - Inline Diff Visualization (Priority: P1)

Users can view AI-generated code changes as inline diff overlays directly in the editor.

**Acceptance Scenarios**:

1. **Given** an AI generates code changes, **When** the diff is created, **Then** overlays appear inline showing additions/deletions
2. **Given** overlays are displayed, **When** user hovers over an overlay, **Then** detailed change information is shown

### User Story 2 - Accept/Reject Changes (Priority: P1)

Users can accept or reject individual diff overlays or all changes at once.

**Acceptance Scenarios**:

1. **Given** a diff overlay is displayed, **When** user clicks accept, **Then** the change is applied to the file
2. **Given** multiple overlays exist, **When** user clicks "Accept All", **Then** all pending changes are applied

### User Story 3 - Multi-File Navigation (Priority: P2)

Users can navigate between files with pending changes and between overlays within a file.

**Acceptance Scenarios**:

1. **Given** multiple files have changes, **When** user uses navigation commands, **Then** cursor moves to next/previous overlay
2. **Given** overlays exist, **When** user opens quick pick, **Then** all overlays are listed for selection

### User Story 4 - Session Persistence (Priority: P2)

Session state is persisted across VSCode restarts.

**Acceptance Scenarios**:

1. **Given** user has pending changes, **When** VSCode restarts, **Then** session state is restored
2. **Given** session is restored, **When** user views files, **Then** previous overlays are displayed

## Requirements

### Functional Requirements

- **FR-001**: System MUST display diff overlays inline in the editor
- **FR-002**: System MUST support accept/reject operations on individual overlays
- **FR-003**: System MUST support batch accept/reject operations
- **FR-004**: System MUST persist session state using VSCode Memento API
- **FR-005**: System MUST manage memory usage for large file operations
- **FR-006**: System MUST process diffs in background to maintain UI responsiveness
- **FR-007**: System MUST provide navigation between overlays
- **FR-008**: System MUST integrate with CodeIndexOrchestrator for memory management

### Key Entities

- **FileBuffer**: Represents editor content buffer for each open file
- **ShadowBuffer**: Stores original and modified content for diff comparison
- **DiffOverlay**: Represents a single diff change with accept/reject state
- **SessionState**: Tracks active buffers, file states, and settings

## Integration Points

### Extension Activation

The Multi-File Diff System is initialized during extension activation in `src/extension.ts`:

```typescript
import { initializeMultiFileDiffSystem } from "./multi-file-diff-system"

// During activation
await initializeMultiFileDiffSystem(context)
```

### CodeIndexOrchestrator Integration

Memory management is integrated with the CodeIndexOrchestrator in `src/services/code-index/orchestrator.ts`:

```typescript
import { MemoryManagementService } from "../performance/memory-management"

// Check memory before indexing
const memoryManager = MemoryManagementService.getInstance()
if (!memoryManager.startOperation(operationId)) {
	// Handle memory constraint
}
```

## Success Criteria

- **SC-001**: All TypeScript type checks pass (0 errors)
- **SC-002**: Extension activates successfully with Multi-File Diff System
- **SC-003**: Memory usage stays within configured thresholds during large file operations
- **SC-004**: Diff overlays render correctly in the editor
- **SC-005**: Session state persists across VSCode restarts
