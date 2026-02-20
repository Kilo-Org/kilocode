import { describe, it, expect } from "bun:test"
import {
  ApiProviderError,
  isApiProviderError,
  getApiProviderErrorProperties,
  ConsecutiveMistakeError,
  isConsecutiveMistakeError,
  getConsecutiveMistakeErrorProperties,
} from "../../src/services/telemetry/errors"

describe("ApiProviderError", () => {
  it("constructs with required fields", () => {
    const err = new ApiProviderError("failed", "openai", "gpt-4", "chat")
    expect(err.message).toBe("failed")
    expect(err.provider).toBe("openai")
    expect(err.modelId).toBe("gpt-4")
    expect(err.operation).toBe("chat")
    expect(err.errorCode).toBeUndefined()
    expect(err.name).toBe("ApiProviderError")
  })

  it("constructs with optional errorCode", () => {
    const err = new ApiProviderError("rate limited", "anthropic", "claude-3", "stream", 429)
    expect(err.errorCode).toBe(429)
  })

  it("is an instance of Error", () => {
    const err = new ApiProviderError("x", "p", "m", "o")
    expect(err instanceof Error).toBe(true)
  })

  it("errorCode of 0 is preserved", () => {
    const err = new ApiProviderError("x", "p", "m", "o", 0)
    expect(err.errorCode).toBe(0)
  })
})

describe("isApiProviderError", () => {
  it("returns true for ApiProviderError instance", () => {
    const err = new ApiProviderError("x", "openai", "gpt-4", "chat")
    expect(isApiProviderError(err)).toBe(true)
  })

  it("returns false for plain Error", () => {
    expect(isApiProviderError(new Error("x"))).toBe(false)
  })

  it("returns false for null", () => {
    expect(isApiProviderError(null)).toBe(false)
  })

  it("returns false for undefined", () => {
    expect(isApiProviderError(undefined)).toBe(false)
  })

  it("returns false for plain object", () => {
    expect(isApiProviderError({ name: "ApiProviderError", provider: "x" })).toBe(false)
  })

  it("returns false when name differs", () => {
    const err = new ApiProviderError("x", "p", "m", "o")
    err.name = "SomethingElse"
    expect(isApiProviderError(err)).toBe(false)
  })

  it("returns true for deserialized error with matching name and properties", () => {
    const err = Object.assign(new Error("x"), {
      name: "ApiProviderError",
      provider: "openai",
      modelId: "gpt-4",
      operation: "chat",
    })
    expect(isApiProviderError(err)).toBe(true)
  })
})

describe("getApiProviderErrorProperties", () => {
  it("returns all required properties", () => {
    const err = new ApiProviderError("x", "openai", "gpt-4", "chat")
    const props = getApiProviderErrorProperties(err)
    expect(props).toEqual({ provider: "openai", modelId: "gpt-4", operation: "chat" })
  })

  it("includes errorCode when present", () => {
    const err = new ApiProviderError("x", "openai", "gpt-4", "chat", 429)
    const props = getApiProviderErrorProperties(err)
    expect(props).toEqual({ provider: "openai", modelId: "gpt-4", operation: "chat", errorCode: 429 })
  })

  it("omits errorCode when undefined", () => {
    const err = new ApiProviderError("x", "openai", "gpt-4", "chat")
    const props = getApiProviderErrorProperties(err)
    expect("errorCode" in props).toBe(false)
  })

  it("includes errorCode of 0", () => {
    const err = new ApiProviderError("x", "openai", "gpt-4", "chat", 0)
    const props = getApiProviderErrorProperties(err)
    expect(props.errorCode).toBe(0)
  })
})

describe("ConsecutiveMistakeError", () => {
  it("constructs with required fields and default reason", () => {
    const err = new ConsecutiveMistakeError("too many", "task-1", 3, 5)
    expect(err.message).toBe("too many")
    expect(err.taskId).toBe("task-1")
    expect(err.consecutiveMistakeCount).toBe(3)
    expect(err.consecutiveMistakeLimit).toBe(5)
    expect(err.reason).toBe("unknown")
    expect(err.provider).toBeUndefined()
    expect(err.modelId).toBeUndefined()
    expect(err.name).toBe("ConsecutiveMistakeError")
  })

  it("constructs with all optional fields", () => {
    const err = new ConsecutiveMistakeError("x", "t", 1, 3, "no_tools_used", "openai", "gpt-4")
    expect(err.reason).toBe("no_tools_used")
    expect(err.provider).toBe("openai")
    expect(err.modelId).toBe("gpt-4")
  })

  it("is an instance of Error", () => {
    const err = new ConsecutiveMistakeError("x", "t", 1, 3)
    expect(err instanceof Error).toBe(true)
  })
})

describe("isConsecutiveMistakeError", () => {
  it("returns true for ConsecutiveMistakeError instance", () => {
    const err = new ConsecutiveMistakeError("x", "t", 1, 3)
    expect(isConsecutiveMistakeError(err)).toBe(true)
  })

  it("returns false for plain Error", () => {
    expect(isConsecutiveMistakeError(new Error("x"))).toBe(false)
  })

  it("returns false for ApiProviderError", () => {
    const err = new ApiProviderError("x", "p", "m", "o")
    expect(isConsecutiveMistakeError(err)).toBe(false)
  })

  it("returns false for null", () => {
    expect(isConsecutiveMistakeError(null)).toBe(false)
  })

  it("returns false when name differs", () => {
    const err = new ConsecutiveMistakeError("x", "t", 1, 3)
    err.name = "OtherError"
    expect(isConsecutiveMistakeError(err)).toBe(false)
  })
})

describe("getConsecutiveMistakeErrorProperties", () => {
  it("returns all required properties", () => {
    const err = new ConsecutiveMistakeError("x", "task-1", 3, 5)
    const props = getConsecutiveMistakeErrorProperties(err)
    expect(props).toEqual({
      taskId: "task-1",
      consecutiveMistakeCount: 3,
      consecutiveMistakeLimit: 5,
      reason: "unknown",
    })
  })

  it("includes provider and modelId when present", () => {
    const err = new ConsecutiveMistakeError("x", "t", 1, 3, "tool_repetition", "anthropic", "claude-3")
    const props = getConsecutiveMistakeErrorProperties(err)
    expect(props.provider).toBe("anthropic")
    expect(props.modelId).toBe("claude-3")
  })

  it("omits provider and modelId when undefined", () => {
    const err = new ConsecutiveMistakeError("x", "t", 1, 3)
    const props = getConsecutiveMistakeErrorProperties(err)
    expect("provider" in props).toBe(false)
    expect("modelId" in props).toBe(false)
  })

  it("includes reason correctly for each reason type", () => {
    const reasons = ["no_tools_used", "tool_repetition", "unknown"] as const
    for (const reason of reasons) {
      const err = new ConsecutiveMistakeError("x", "t", 1, 3, reason)
      expect(getConsecutiveMistakeErrorProperties(err).reason).toBe(reason)
    }
  })
})
