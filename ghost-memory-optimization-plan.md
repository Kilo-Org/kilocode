# GhostProvider Memory Optimization Implementation Plan

## Overview

This document provides a focused plan for fixing the critical memory issues in the GhostProvider system. Each task addresses a specific memory problem that's causing stability issues.

## Memory Monitoring (Optional Enhancement)

### Output Channel Logging

- Create dedicated "Kilo Code Memory" output channel
- Log memory stats periodically with timestamps
- Include heap usage, document count, AST count, parser count
- Provide visibility into memory usage patterns

## Critical Memory Fixes

### Issue 1: Unbounded Document Storage

**Problem**: Document store grows indefinitely without cleanup
**File**: `src/services/ghost/GhostDocumentStore.ts`
**Solution**: Add LRU eviction when document limit is exceeded

### Issue 2: Large File AST Parsing

**Problem**: Very large files consume excessive memory for AST parsing
**File**: `src/services/ghost/GhostDocumentStore.ts`
**Solution**: Skip AST parsing for files over size/line limits

### Issue 3: Parser Instance Recreation

**Problem**: Tree-sitter parsers are recreated instead of reused
**File**: `src/services/tree-sitter/languageParser.ts`
**Solution**: Implement global parser cache with reuse

### Issue 4: Inefficient Debouncing

**Problem**: Fixed 500ms debounce causes unnecessary parsing
**File**: `src/services/ghost/GhostDocumentStore.ts`
**Solution**: Dynamic debounce timing based on file size

## Implementation Tasks

### Task 1: Document Store Size Management

- Add `lastAccessed` timestamp to document items
- Implement LRU eviction when MAX_DOCUMENTS exceeded
- Call enforcement on every store operation

### Task 2: AST Size Limits

- Add file size check before parsing (5MB limit)
- Add line count check (10k lines limit)
- Skip parsing with warning for large files

### Task 3: Parser Instance Reuse

- Create global parser cache
- Implement usage counting for parsers
- Add parser disposal methods

### Task 4: Smart Debouncing

- Dynamic debounce timing based on file size
- Shorter delays for small files, longer for large files
- Reduce unnecessary AST parsing frequency

### Task 5: Memory Monitoring (Optional)

- Create MemoryPressureService for monitoring
- Add output channel for memory logging
- Integrate with existing services for visibility

## Task Order

1. **Task 2: AST Size Limits** (Highest Impact - Prevents large memory allocations)
2. **Task 1: Document Store Size Management** (Prevents unbounded growth)
3. **Task 3: Parser Instance Reuse** (Eliminates parser recreation overhead)
4. **Task 4: Smart Debouncing** (Reduces parsing frequency)
5. **Task 5: Memory Monitoring** (Optional - Provides visibility)

Each task can be implemented and committed independently.
