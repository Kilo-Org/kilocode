# Refactor Code Tool - Approval Flow Fix

## Problem

The refactor code tool is applying changes before asking for user approval, which causes:

1. Changes are visible in the editor before approval
2. The LLM gets confused reading the old state after changes are already applied
3. The approval flow is backwards compared to other tools

## Root Cause

The refactor tool directly executes VS Code refactoring commands (like `vscode.workspace.applyEdit`) which immediately apply changes, then asks for approval afterwards. This is different from other tools that use `DiffViewProvider` to preview changes first.

## Solution

Since VS Code's refactoring API doesn't support previewing changes, we need to:

1. **Capture original content** - Read the file content before refactoring
2. **Apply refactoring** - Execute the VS Code refactoring command
3. **Capture new content** - Read the file content after refactoring
4. **Revert changes** - Undo the refactoring
5. **Show diff preview** - Use DiffViewProvider to show the changes
6. **Handle approval**:
    - If approved: Re-apply the refactoring
    - If rejected: Do nothing (already reverted)

## Implementation Changes

### Key Changes to `refactorCodeTool.ts`:

1. Add file content capture before refactoring
2. Add content capture after refactoring
3. Immediately undo after capturing changes
4. Use DiffViewProvider to show preview
5. Re-apply refactoring only if approved

### Benefits:

- Consistent approval flow with other tools
- User sees changes in diff view before they're applied
- No confusion about file state
- User can edit the changes in diff view if needed
