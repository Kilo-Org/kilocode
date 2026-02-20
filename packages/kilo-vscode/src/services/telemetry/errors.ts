export class ApiProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly modelId: string,
    public readonly operation: string,
    public readonly errorCode?: number,
  ) {
    super(message)
    this.name = "ApiProviderError"
  }
}

export function isApiProviderError(error: unknown): error is ApiProviderError {
  return (
    error instanceof Error &&
    error.name === "ApiProviderError" &&
    "provider" in error &&
    "modelId" in error &&
    "operation" in error
  )
}

export function getApiProviderErrorProperties(error: ApiProviderError): Record<string, unknown> {
  return {
    provider: error.provider,
    modelId: error.modelId,
    operation: error.operation,
    ...(error.errorCode !== undefined && { errorCode: error.errorCode }),
  }
}

export type ConsecutiveMistakeReason = "no_tools_used" | "tool_repetition" | "unknown"

export class ConsecutiveMistakeError extends Error {
  constructor(
    message: string,
    public readonly taskId: string,
    public readonly consecutiveMistakeCount: number,
    public readonly consecutiveMistakeLimit: number,
    public readonly reason: ConsecutiveMistakeReason = "unknown",
    public readonly provider?: string,
    public readonly modelId?: string,
  ) {
    super(message)
    this.name = "ConsecutiveMistakeError"
  }
}

export function isConsecutiveMistakeError(error: unknown): error is ConsecutiveMistakeError {
  return (
    error instanceof Error &&
    error.name === "ConsecutiveMistakeError" &&
    "taskId" in error &&
    "consecutiveMistakeCount" in error &&
    "consecutiveMistakeLimit" in error
  )
}

export function getConsecutiveMistakeErrorProperties(error: ConsecutiveMistakeError): Record<string, unknown> {
  return {
    taskId: error.taskId,
    consecutiveMistakeCount: error.consecutiveMistakeCount,
    consecutiveMistakeLimit: error.consecutiveMistakeLimit,
    reason: error.reason,
    ...(error.provider !== undefined && { provider: error.provider }),
    ...(error.modelId !== undefined && { modelId: error.modelId }),
  }
}
