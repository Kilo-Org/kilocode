# Commit Message Generation Refactor Implementation Plan

## Overview

Refactor VSCode commit message generation to separate file selection from AI generation, enabling file-specific commit messages for both VSCode and JetBrains.

## Current Architecture

```
VSCode: CommitMessageProvider → gatherGitChanges → GitExtensionService → AI
JetBrains: RPC(workspacePath) → VSCode generateCommitMessageForExternal → AI
```

## Target Architecture

```
VSCode: getSelectedFiles → generateCommitMessageForFiles → AI
JetBrains: getCheckedFiles → RPC(workspacePath, files[]) → generateCommitMessageForFiles → AI
```

## Implementation Steps

### Phase 1: VSCode Core Refactoring

- [ ]   1. Create `generateCommitMessageForFiles(workspacePath, files[])` function
- [ ]   2. Create `getSelectedFiles(workspacePath)` function (staged first, fallback to unstaged)
- [ ]   3. Refactor `generateCommitMessageVsCode()` to use new functions
- [ ]   4. Update `GitExtensionService.getCommitContext()` to accept file list parameter
- [ ]   5. Add console logging for debugging

### Phase 2: RPC Boundary Extension

- [ ]   6. Extend command registration to accept file list parameter
- [ ]   7. Update `generateCommitMessageForExternal()` to support file list
- [ ]   8. Add schema validation for new parameter format
- [ ]   9. Maintain backward compatibility with workspace-only calls

### Phase 3: JetBrains Integration

- [ ]   10. Update JetBrains RPC call to include selected files
- [ ]   11. Extract checked files from JetBrains commit dialog
- [ ]   12. Add console logging on JetBrains side for debugging

### Phase 4: Testing & Cleanup

- [ ]   13. Update all tests to match new implementation
- [ ]   14. Test cross-platform RPC boundary
- [ ]   15. Verify backward compatibility
- [ ]   16. Performance testing with large file lists

## Key Files to Modify

### VSCode Side

- `src/services/commit-message/CommitMessageProvider.ts` - Main refactoring
- `src/services/commit-message/GitExtensionService.ts` - Accept file list param
- `src/services/commit-message/types.ts` - New type definitions

### JetBrains Side

- `jetbrains/plugin/src/main/kotlin/ai/kilocode/jetbrains/git/CommitMessageService.kt` - RPC params
- `jetbrains/plugin/src/main/kotlin/ai/kilocode/jetbrains/git/CommitMessageHandler.kt` - Extract checked files

### Tests (Update Later)

- `src/services/commit-message/__tests__/CommitMessageProvider.test.ts`
- `src/services/commit-message/__tests__/GitExtensionService.spec.ts`

## RPC Parameter Format

```typescript
// Current: [workspacePath: string]
// New: [workspacePath: string, selectedFiles?: string[]]
```

## Debugging Strategy

- Console log on VSCode side: file selection and RPC parameters
- Console log on JetBrains side: checked files and RPC call
- Log file paths being processed for commit message generation

## Backward Compatibility

- If no file list provided, use existing staging logic
- Existing JetBrains installations continue working
- Gradual rollout of file-specific features
