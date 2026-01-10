# Research Findings: Multi-File Diff and Auto-Navigation System

**Date**: January 10, 2026  
**Purpose**: Resolve technical unknowns for implementation planning

## Kilo Code Extension APIs

**Decision**: Use existing VSCode extension APIs with Kilo Code integration points  
**Rationale**: Kilo Code is built as a VSCode extension, leveraging VSCode's rich editor API ecosystem provides the most robust foundation for diff visualization and file management  
**Alternatives considered**: 
- Custom editor implementation (rejected: excessive complexity, maintenance burden)
- Direct file system manipulation (rejected: loses editor integration, undo/redo capabilities)

**Key Integration Points**:
- `vscode.window.showTextDocument()` for file opening
- `vscode.workspace.onDidChangeTextDocument()` for change tracking
- Decoration API for diff overlay rendering
- Tab management through VSCode's tab groups

## VSCode Extension Constraints

**Decision**: Work within VSCode's decoration and webview constraints  
**Rationale**: VSCode provides sufficient capabilities for inline diff rendering through decoration API and custom webviews for complex interactions  
**Alternatives considered**:
- Full custom editor (rejected: not feasible within VSCode extension model)
- External diff tools (rejected: breaks user workflow, loses integration)

**Key Constraints Identified**:
- Decorations limited to text styling (colors, backgrounds, text decorations)
- Webview required for complex interactive elements
- Performance considerations for large files with many decorations
- Memory management for multiple simultaneous file states

## Diff Library Selection

**Decision**: Use `diff` library (npm) with custom Myers algorithm implementation for performance-critical paths  
**Rationale**: `diff` library provides well-tested implementation with TypeScript support, custom implementation allows optimization for streaming and large file scenarios  
**Alternatives considered**:
- Custom Myers implementation only (rejected: higher maintenance, testing burden)
- `myers-diff` library (rejected: less mature, limited TypeScript support)
- `jsdiff` library (rejected: performance issues with large files)

**Library Details**:
- Primary: `diff` package for character and line-based diffing
- Custom streaming implementation for large files
- Memory-efficient chunked processing for 10MB+ files

## Performance Requirements

**Decision**: Implement streaming with 64KB chunks and background processing  
**Rationale**: Balances memory usage with UI responsiveness, 64KB chunks provide good throughput without blocking main thread  
**Alternatives considered**:
- Smaller chunks (rejected: excessive overhead, complexity)
- Larger chunks (rejected: risk of UI blocking)
- Web Workers (rejected: VSCode extension sandbox limitations)

**Performance Targets**:
- Sub-200ms UI response time for user interactions
- Streaming processing for files >1MB
- Maximum 100MB memory usage for diff operations
- Support for 10+ simultaneous file diffs

## Session State Persistence

**Decision**: Use VSCode's `Memento` API for workspace state + in-memory for active session  
**Rationale**: Provides persistence across VSCode restarts while maintaining performance for active operations  
**Alternatives considered**:
- File-based persistence (rejected: slower, synchronization issues)
- Database solution (rejected: overkill, complexity)
- Pure in-memory (rejected: loses state on restart)

**State Management Strategy**:
- `Memento` for persistent AI modification history
- In-memory maps for active diff states
- Event-driven state synchronization between components
- Automatic cleanup of stale session data

## Best Practices Summary

### VSCode Extension Diff Visualization
- Use Decoration API for inline styling (green backgrounds, red strikethrough)
- Implement custom webview for complex accept/reject controls
- Leverage TextEditorContentChange events for real-time updates
- Use Command API for user interactions (accept/reject commands)

### Non-blocking Streaming in TypeScript
- Implement async generators for chunked processing
- Use `setImmediate` or `requestIdleCallback` for yielding control
- Process in background while maintaining UI responsiveness
- Implement cancellation tokens for interrupted operations

### Multi-file State Management
- Centralized state manager with event emission
- File-specific state isolation to prevent cross-contamination
- Efficient state serialization for persistence
- Memory cleanup for closed/unused file states

### Color Scheme Accessibility
- Use VSCode theme colors for consistency
- Ensure sufficient contrast ratios (WCAG AA compliance)
- Support both light and dark themes
- Provide user-configurable color schemes if needed

## Implementation Decions Summary

All NEEDS CLARIFICATION items have been resolved with practical, implementable solutions that balance performance, maintainability, and user experience within VSCode extension constraints.
