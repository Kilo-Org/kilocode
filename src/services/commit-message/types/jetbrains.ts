/**
 * JetBrains-specific types for commit message integration.
 * These types define the contract for communication between
 * the VSCode extension and JetBrains IDEs via RPC or other mechanisms.
 */

export type JetbrainsGenerationRequest = [workspacePath: string, selectedFiles: string[]]
