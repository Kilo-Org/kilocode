/**
 * Sara RLM — Error Types (Phase 2 extended)
 *
 * Sealed error hierarchy discriminated by `_tag`.
 */

// --- Phase 1 errors (preserved) ---

export type RLMModelNotFoundError = {
  readonly _tag: "RLMModelNotFoundError"
  readonly message: string
  readonly providerID?: string
  readonly modelID?: string
  readonly cause?: unknown
}

export type RLMAgentNotFoundError = {
  readonly _tag: "RLMAgentNotFoundError"
  readonly message: string
  readonly agentName?: string
  readonly cause?: unknown
}

export type RLMExecutionError = {
  readonly _tag: "RLMExecutionError"
  readonly message: string
  readonly cause?: unknown
}

export type RLMAbortedError = {
  readonly _tag: "RLMAbortedError"
  readonly message: string
  readonly cause?: unknown
}

export type RLMSessionNotFoundError = {
  readonly _tag: "RLMSessionNotFoundError"
  readonly message: string
  readonly sessionID?: string
  readonly cause?: unknown
}

export type RLMPromptError = {
  readonly _tag: "RLMPromptError"
  readonly message: string
  readonly cause?: unknown
}

// --- Phase 2 errors ---

export type RLMBudgetExceededError = {
  readonly _tag: "RLMBudgetExceededError"
  readonly message: string
  readonly used: number
  readonly limit: number
  readonly cause?: unknown
}

export type RLMDepthExceededError = {
  readonly _tag: "RLMDepthExceededError"
  readonly message: string
  readonly depth: number
  readonly maxDepth: number
}

export type RLMPlanningError = {
  readonly _tag: "RLMPlanningError"
  readonly message: string
  readonly reason?: string
  readonly cause?: unknown
}

export type RLMVerificationError = {
  readonly _tag: "RLMVerificationError"
  readonly message: string
  readonly reason?: string
  readonly cause?: unknown
}

export type RLMSchedulingError = {
  readonly _tag: "RLMSchedulingError"
  readonly message: string
  readonly reason?: string
}

export type RLMError =
  | RLMModelNotFoundError
  | RLMAgentNotFoundError
  | RLMExecutionError
  | RLMAbortedError
  | RLMSessionNotFoundError
  | RLMPromptError
  | RLMBudgetExceededError
  | RLMDepthExceededError
  | RLMPlanningError
  | RLMVerificationError
  | RLMSchedulingError

// --- Phase 1 constructors (preserved) ---

export function rlmModelNotFound(message: string, opts?: { providerID?: string; modelID?: string; cause?: unknown }): RLMModelNotFoundError {
  return { _tag: "RLMModelNotFoundError", message, ...opts }
}

export function rlmAgentNotFound(message: string, opts?: { agentName?: string; cause?: unknown }): RLMAgentNotFoundError {
  return { _tag: "RLMAgentNotFoundError", message, ...opts }
}

export function rlmExecutionError(message: string, opts?: { cause?: unknown }): RLMExecutionError {
  return { _tag: "RLMExecutionError", message, ...opts }
}

export function rlmAborted(message: string, opts?: { cause?: unknown }): RLMAbortedError {
  return { _tag: "RLMAbortedError", message, ...opts }
}

export function rlmSessionNotFound(message: string, opts?: { sessionID?: string; cause?: unknown }): RLMSessionNotFoundError {
  return { _tag: "RLMSessionNotFoundError", message, ...opts }
}

export function rlmPromptError(message: string, opts?: { cause?: unknown }): RLMPromptError {
  return { _tag: "RLMPromptError", message, ...opts }
}

// --- Phase 2 constructors ---

export function rlmBudgetExceeded(message: string, opts: { used: number; limit: number; cause?: unknown }): RLMBudgetExceededError {
  return { _tag: "RLMBudgetExceededError", message, used: opts.used, limit: opts.limit, cause: opts.cause }
}

export function rlmDepthExceeded(depth: number, maxDepth: number): RLMDepthExceededError {
  return {
    _tag: "RLMDepthExceededError",
    message: `Depth ${depth} exceeds maximum ${maxDepth}`,
    depth,
    maxDepth,
  }
}

export function rlmPlanningError(message: string, opts?: { reason?: string; cause?: unknown }): RLMPlanningError {
  return { _tag: "RLMPlanningError", message, ...opts }
}

export function rlmVerificationError(message: string, opts?: { reason?: string; cause?: unknown }): RLMVerificationError {
  return { _tag: "RLMVerificationError", message, ...opts }
}

export function rlmSchedulingError(message: string, opts?: { reason?: string }): RLMSchedulingError {
  return { _tag: "RLMSchedulingError", message, ...opts }
}

// --- Helper ---

export function errorMessage(error: RLMError): string {
  return error.message
}