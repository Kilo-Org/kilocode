# Implementation Plan: Indexing, Memory & Context Fixes

## Overview

خطة تنفيذ شاملة لإصلاح 53+ خطأ TypeScript وتكامل نظام Multi-File Diff مع الـ Extension. الخطة مقسمة إلى 4 مراحل رئيسية.

## Tasks

- [x]   1. Phase 1: Type Consolidation and Import Fixes

    - [x] 1.1 Consolidate type definitions in session-types.ts

        - Move SessionState, FileState, SessionSettings to be the single source of truth
        - Update diff-types.ts to re-export from session-types.ts
        - _Requirements: 2.1, 2.2, 2.3, 2.4_

    - [x] 1.2 Fix import paths in event-system.ts

        - Change `../../types/diff-types` to `../types/diff-types`
        - Change `../../types/session-types` to `../types/session-types`
        - _Requirements: 3.2, 7.1_

    - [x] 1.3 Fix import paths in ui/diff-renderer.ts

        - Change `../../types/diff-types` to `../types/diff-types`
        - Change `../error-handler` to `../services/error-handler`
        - Change `../event-system` to `../services/event-system`
        - _Requirements: 3.1, 6.1_

    - [x] 1.4 Fix import paths in ui/interaction-layer.ts

        - Change `../../types/diff-types` to `../types/diff-types`
        - Change `../error-handler` to `../services/error-handler`
        - Change `../event-system` to `../services/event-system`
        - _Requirements: 3.1, 6.2_

    - [x] 1.5 Fix import paths in types/file-state-enhanced.ts

        - Change `../../types/session-types` to `./session-types`
        - _Requirements: 3.3_

    - [x] 1.6 Fix import paths in types/session-types-enhanced.ts
        - Change `../../types/session-types` to `./session-types`
        - _Requirements: 3.3_

- [x]   2. Phase 2: Service and Component Fixes

    - [x] 2.1 Fix FileOpenerService VSCode API types

        - Change `onVisibleEditorsChanged(event: vscode.TextEditor[])` to `(editors: readonly vscode.TextEditor[])`
        - Change `onActiveEditorChanged(event: vscode.TextEditorChangeEvent)` to `(editor: vscode.TextEditor | undefined)`
        - Fix `findExistingTab` return type for document property
        - _Requirements: 1.3, 6.3_

    - [x] 2.2 Fix DiffEngine async issues

        - Mark functions using await as async
        - Fix DiffOverlay import and usage
        - Add content property to FileBufferEntity if missing
        - _Requirements: 5.1, 5.2, 5.3, 5.4_

    - [x] 2.3 Fix DiffOverlayManager issues

        - Fix Expected 2 arguments errors
        - Fix decorationType property issues
        - _Requirements: 6.3_

    - [x] 2.4 Fix error-handler.ts issues

        - Fix null vs undefined type mismatch
        - _Requirements: 1.1_

    - [x] 2.5 Fix user-story1-logger.ts issues

        - Fix required parameter after optional parameter
        - Fix string | Error type assignment
        - _Requirements: 1.1_

    - [x] 2.6 Fix multi-file-coordinator.ts issues

        - Fix timestamp property in CoordinationEvent
        - _Requirements: 1.1_

    - [x] 2.7 Fix multi-file-diff-system.ts initialization function
        - Fix class instantiation to use proper imports
        - Ensure all services are properly imported before use
        - _Requirements: 1.1, 4.1, 4.2, 4.3_

- [x]   3. Phase 3: Integration

    - [x] 3.1 Integrate Multi-File Diff System with extension.ts

        - Import initializeMultiFileDiffSystem
        - Call during extension activation with proper error handling
        - Add to context.subscriptions for cleanup
        - _Requirements: 4.1, 4.2, 4.3, 4.4_

    - [x] 3.2 Integrate MemoryManagementService with CodeIndexOrchestrator

        - Import MemoryManagementService in orchestrator
        - Track indexing operations with startOperation/endOperation
        - Check memory availability before starting indexing
        - _Requirements: 8.1, 8.2, 8.3, 8.4_

    - [ ]\* 3.3 Write property test for Service Initialization

        - **Property 1: Service Initialization Completeness**
        - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

    - [ ]\* 3.4 Write property test for Memory Management Integration
        - **Property 2: Memory Management Integration**
        - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

- [x]   4. Phase 4: Verification and Cleanup

    - [x] 4.1 Run type checks and verify 0 errors

        - Execute `pnpm check-types` in src directory
        - Verify all 53+ errors are resolved
        - _Requirements: 1.1, 3.4_

    - [x] 4.2 Update specs/001-indexing-memory-features/spec.md

        - Replace template content with actual feature documentation
        - Document all services and their interactions
        - _Requirements: 10.1, 10.2, 10.3_

    - [x] 4.3 Checkpoint - Ensure all tests pass

        - Ensure all tests pass, ask the user if questions arise.

    - [ ]\* 4.4 Write integration tests for extension activation
        - Test that all services initialize correctly
        - Test error handling during initialization
        - _Requirements: 4.4, 9.3_

- [x]   5. Final Checkpoint
    - Ensure all tests pass, ask the user if questions arise.
    - Verify `pnpm check-types` returns 0 errors
    - Verify extension activates successfully

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases

## File Changes Summary

| File                                             | Changes                                         |
| ------------------------------------------------ | ----------------------------------------------- |
| `src/types/session-types.ts`                     | Keep as source of truth                         |
| `src/types/diff-types.ts`                        | Re-export from session-types, remove duplicates |
| `src/services/event-system.ts`                   | Fix import paths                                |
| `src/ui/diff-renderer.ts`                        | Fix import paths                                |
| `src/ui/interaction-layer.ts`                    | Fix import paths                                |
| `src/types/file-state-enhanced.ts`               | Fix import paths                                |
| `src/types/session-types-enhanced.ts`            | Fix import paths                                |
| `src/services/file-management/file-opener.ts`    | Fix VSCode API types                            |
| `src/services/diff/diff-engine.ts`               | Fix async/await, imports                        |
| `src/services/diff/diff-overlay.ts`              | Fix argument counts, types                      |
| `src/services/error-handler.ts`                  | Fix null vs undefined                           |
| `src/services/logging/user-story1-logger.ts`     | Fix parameter order, types                      |
| `src/services/session/multi-file-coordinator.ts` | Fix event type                                  |
| `src/multi-file-diff-system.ts`                  | Fix initialization                              |
| `src/extension.ts`                               | Add Multi-File Diff integration                 |
| `src/services/code-index/orchestrator.ts`        | Add memory management                           |
| `specs/001-indexing-memory-features/spec.md`     | Update with actual content                      |
