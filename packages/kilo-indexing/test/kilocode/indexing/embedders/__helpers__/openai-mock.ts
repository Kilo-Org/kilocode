// Shared mock state for the "openai" module used across multiple embedder test files.
// RATIONALE: mock.module() is process-wide in Bun - multiple test files calling
// mock.module("openai", ...) with separate mock functions causes cross-test interference.
// By sharing the mock function, whichever file's mock.module call wins, all tests
// still reference the same mockEmbeddingsCreate instance.
//
// Each test file must still call mock.module("openai", openAIMockFactory) directly
// because Bun only processes mock.module calls in the test file itself (not in imports).

import { mock } from "bun:test"

export const mockEmbeddingsCreate = mock()

let _constructorHook: ((config: any) => void) | undefined

export function setOpenAIConstructorHook(hook: ((config: any) => void) | undefined) {
  _constructorHook = hook
}

export function openAIMockFactory() {
  return {
    OpenAI: class {
      config: any
      embeddings = { create: mockEmbeddingsCreate }
      constructor(config: any) {
        this.config = config
        if (_constructorHook) {
          _constructorHook(config)
        }
      }
    },
  }
}
