import { expect, test } from "bun:test"
import { isExplicitOllamaTemperature } from "../../src/session/llm/sampling-temperature"

test("explicit Ollama temperature includes zero", () => {
  expect(isExplicitOllamaTemperature("ollama_local", 0)).toBe(true)
  expect(isExplicitOllamaTemperature("ollama", 0.4)).toBe(true)
  expect(isExplicitOllamaTemperature("ollama-local", 2)).toBe(true)
})

test("unconfigured and unrelated providers remain untouched", () => {
  expect(isExplicitOllamaTemperature("ollama_local", undefined)).toBe(false)
  expect(isExplicitOllamaTemperature("openai", 0.4)).toBe(false)
  expect(isExplicitOllamaTemperature("anthropic", 0.4)).toBe(false)
})
