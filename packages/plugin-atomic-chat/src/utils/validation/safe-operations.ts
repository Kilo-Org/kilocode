export async function safeAsyncOperation<T>(
  operation: () => Promise<T>,
  fallback?: T,
  onError?: (error: Error) => void
): Promise<T | undefined> {
  try {
    return await operation()
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    onError?.(err)
    return fallback
  }
}
