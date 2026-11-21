import { describe, test, expect } from "bun:test"
import {
  extractStatusCode,
  formatEmbeddingError,
  rejectionStatus,
  sanitizeErrorMessage,
  withValidationErrorHandling,
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
  test.each([
    { name: "status property", error: { status: 400 }, expected: 400 },
    { name: "response status", error: { response: { status: 422 } }, expected: 422 },
    {
      name: "AWS SDK $metadata (ignored, so validation keeps the AWS message)",
      error: { name: "ValidationException", $metadata: { httpStatusCode: 400 } },
      expected: undefined,
    },
    { name: "HTTP message", error: new Error("HTTP 413: too large"), expected: 413 },
    { name: "no status", error: new Error("boom"), expected: undefined },
  ])("reads $name", ({ error, expected }) => {
    expect(extractStatusCode(error)).toBe(expected)
  })

  test("formatEmbeddingError keeps the status of an AWS SDK error", () => {
    const sdkError = Object.assign(new Error("Too many input tokens"), { $metadata: { httpStatusCode: 400 } })

    expect(extractStatusCode(formatEmbeddingError(sdkError, 3))).toBe(400)
  })
})

describe("rejectionStatus", () => {
  test("reads the AWS SDK $metadata status in addition to the usual sources", () => {
    expect(rejectionStatus({ $metadata: { httpStatusCode: 400 } })).toBe(400)
    expect(rejectionStatus({ status: 422 })).toBe(422)
    expect(rejectionStatus(new Error("HTTP 413: too large"))).toBe(413)
    expect(rejectionStatus({ $metadata: { httpStatusCode: 0 } })).toBeUndefined()
    expect(rejectionStatus("boom")).toBeUndefined()
  })

  test("validation keeps the specific message of a Bedrock ValidationException", async () => {
    const aws = Object.assign(new Error("The provided model identifier is invalid"), {
      name: "ValidationException",
      $metadata: { httpStatusCode: 400 },
    })

    const result = await withValidationErrorHandling(() => Promise.reject(aws), "bedrock")

    expect(result).toEqual({ valid: false, error: "The provided model identifier is invalid" })
    expect(rejectionStatus(aws)).toBe(400)
  })
})
