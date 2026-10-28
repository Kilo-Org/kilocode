import { describe, test, expect } from "bun:test"
import {
  extractStatusCode,
  formatEmbeddingError,
  isContextOverflowError,
  isNonRetryableEmbeddingError,
  sanitizeErrorMessage,
} from "../../../../src/indexing/shared/validation-helpers"

describe("sanitizeErrorMessage", () => {
  test("should sanitize Unix-style file paths", () => {
    const input = "Error reading file /Users/username/projects/myapp/src/index.ts"
    const expected = "Error reading file [REDACTED_PATH]"
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should sanitize Windows-style file paths", () => {
    const input = "Cannot access C:\\Users\\username\\Documents\\project\\file.js"
    const expected = "Cannot access [REDACTED_PATH]"
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should sanitize relative file paths", () => {
    const input = "File not found: ./src/components/Button.tsx"
    const expected = "File not found: [REDACTED_PATH]"
    expect(sanitizeErrorMessage(input)).toBe(expected)

    const input2 = "Cannot read ../config/settings.json"
    const expected2 = "Cannot read [REDACTED_PATH]"
    expect(sanitizeErrorMessage(input2)).toBe(expected2)
  })

  test("should sanitize URLs with various protocols", () => {
    const input = "Failed to connect to http://localhost:11434/api/embed"
    const expected = "Failed to connect to [REDACTED_URL]"
    expect(sanitizeErrorMessage(input)).toBe(expected)

    const input2 = "Error fetching https://api.example.com:8080/v1/embeddings"
    const expected2 = "Error fetching [REDACTED_URL]"
    expect(sanitizeErrorMessage(input2)).toBe(expected2)
  })

  test("should sanitize IP addresses", () => {
    const input = "Connection refused at 192.168.1.100"
    const expected = "Connection refused at [REDACTED_IP]"
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should sanitize port numbers", () => {
    const input = "Server running on :8080 failed"
    const expected = "Server running on :[REDACTED_PORT] failed"
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should sanitize email addresses", () => {
    const input = "User john.doe@example.com not found"
    const expected = "User [REDACTED_EMAIL] not found"
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should sanitize paths in quotes", () => {
    const input = 'Cannot open file "/home/user/documents/secret.txt"'
    const expected = 'Cannot open file "[REDACTED_PATH]"'
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should handle complex error messages with multiple sensitive items", () => {
    const input = "Failed to fetch http://localhost:11434 from /Users/john/project at 192.168.1.1:3000"
    const expected = "Failed to fetch [REDACTED_URL] from [REDACTED_PATH] at [REDACTED_IP]:[REDACTED_PORT]"
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should handle non-string inputs gracefully", () => {
    expect(sanitizeErrorMessage(null as any)).toBe("null")
    expect(sanitizeErrorMessage(undefined as any)).toBe("undefined")
    expect(sanitizeErrorMessage(123 as any)).toBe("123")
    expect(sanitizeErrorMessage({} as any)).toBe("[object Object]")
  })

  test("should preserve non-sensitive error messages", () => {
    const input = "Invalid JSON format"
    expect(sanitizeErrorMessage(input)).toBe(input)

    const input2 = "Connection timeout"
    expect(sanitizeErrorMessage(input2)).toBe(input2)
  })

  test("should handle file paths with special characters", () => {
    const input = 'Error in "/path/to/file with spaces.txt"'
    const expected = 'Error in "[REDACTED_PATH]"'
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should sanitize multiple occurrences of sensitive data", () => {
    const input = "Copy from /src/file1.js to /dest/file2.js failed"
    const expected = "Copy from [REDACTED_PATH] to [REDACTED_PATH] failed"
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })
})

describe("extractStatusCode", () => {
  test("reads a direct status property", () => {
    expect(extractStatusCode({ status: 404 })).toBe(404)
  })

  test("reads a nested response.status property", () => {
    expect(extractStatusCode({ response: { status: 500 } })).toBe(500)
  })

  test("reads AWS SDK v3 $metadata.httpStatusCode", () => {
    expect(extractStatusCode({ $metadata: { httpStatusCode: 400 } })).toBe(400)
  })

  test("reads a status embedded in the error message", () => {
    expect(extractStatusCode(new Error("HTTP 429: Too Many Requests"))).toBe(429)
  })

  test("prefers direct status over $metadata", () => {
    expect(extractStatusCode({ status: 401, $metadata: { httpStatusCode: 400 } })).toBe(401)
  })

  test("returns undefined when no status is present", () => {
    expect(extractStatusCode(new Error("ECONNREFUSED"))).toBeUndefined()
  })
})

describe("isContextOverflowError", () => {
  const withStatus = (message: string, status: number): any => Object.assign(new Error(message), { status })

  test("detects the observed Granite/512-token message", () => {
    expect(isContextOverflowError(withStatus("input (517 tokens) is larger than the max context size (512 tokens)", 400))).toBe(
      true,
    )
  })

  test.each([
    ["This model's maximum context length is 8192 tokens", 400],
    ["Request exceeds the maximum context limit for this model", 400],
    ["input is too long for the embedding model", 400],
    ["Prompt is too long", 400],
    ["you provided too many tokens", 400],
    ["The input text exceeds the maximum token limit", 400],
    ["Payload Too Large", 413],
  ])("detects a context-overflow 4xx: %s", (message, status) => {
    expect(isContextOverflowError(withStatus(message, status))).toBe(true)
  })

  test.each([
    ["Authentication failed", 401],
    ["Model not found", 404],
    ["Rate limit exceeded", 429],
    ["Internal server error", 500],
    ["Input had invalid characters", 400],
  ])("does not treat a non-overflow %s as a context overflow: %d", (message, status) => {
    expect(isContextOverflowError(withStatus(message, status))).toBe(false)
  })

  test("does not match a success or connection error", () => {
    expect(isContextOverflowError(withStatus("Request too large", 200))).toBe(false)
    expect(isContextOverflowError(new Error("ECONNREFUSED"))).toBe(false)
  })

  test("matches on message alone when the status code is unavailable", () => {
    expect(isContextOverflowError(new Error("input (517 tokens) is larger than the max context size (512 tokens)"))).toBe(
      true,
    )
  })
})

describe("isNonRetryableEmbeddingError", () => {
  const withStatus = (status: number): any => Object.assign(new Error("request failed"), { status })

  test.each([400, 401, 403, 404, 422])("treats a deterministic %d client error as non-retryable", (status) => {
    expect(isNonRetryableEmbeddingError(withStatus(status))).toBe(true)
  })

  test("keeps 408, 425, 429 and 5xx retryable", () => {
    expect(isNonRetryableEmbeddingError(withStatus(408))).toBe(false)
    expect(isNonRetryableEmbeddingError(withStatus(425))).toBe(false)
    expect(isNonRetryableEmbeddingError(withStatus(429))).toBe(false)
    expect(isNonRetryableEmbeddingError(withStatus(500))).toBe(false)
    expect(isNonRetryableEmbeddingError(withStatus(503))).toBe(false)
  })

  test("treats errors without a status code (network) as retryable", () => {
    expect(isNonRetryableEmbeddingError(new Error("ECONNREFUSED"))).toBe(false)
  })
})

describe("formatEmbeddingError", () => {
  test("preserves the HTTP status on the returned error", () => {
    const error = formatEmbeddingError(Object.assign(new Error("bad request"), { status: 400 }), 3)
    expect(error).toBeInstanceOf(Error)
    expect((error as any).status).toBe(400)
    expect(error.message).toContain("status 400")
  })

  test("omits the status when none is present", () => {
    const error = formatEmbeddingError(new Error("boom"), 3)
    expect((error as any).status).toBeUndefined()
    expect(error.message).toBe("Embedding request failed after 3 attempts: boom")
  })
})
