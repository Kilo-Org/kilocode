/**
 * Worktree Module
 *
 * Platform-agnostic git worktree management functionality.
 * These exports are decoupled from VSCode and can be used by any consumer.
 */

// Types
export * from "./types.js"

// Services
export { WorktreeService, worktreeService } from "./worktree-service.js"
export { WorktreeIncludeService, worktreeIncludeService, type CopyProgressCallback } from "./worktree-include.js"
