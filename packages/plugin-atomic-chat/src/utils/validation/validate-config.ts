import type { ValidationResult } from "./validation-result"
import { ATOMIC_CHAT_PROVIDER_KEY } from "../../constants"

export function validateConfig(config: any): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!config || typeof config !== "object") {
    errors.push("Config must be an object")
    return { isValid: false, errors, warnings }
  }

  if (config.provider && typeof config.provider === "object") {
    const atomic = config.provider[ATOMIC_CHAT_PROVIDER_KEY]
    if (atomic) {
      if (!atomic.npm) {
        atomic.npm = "@ai-sdk/openai-compatible"
        warnings.push(`Atomic Chat provider missing npm field, auto-set to @ai-sdk/openai-compatible`)
      }
      if (!atomic.name) {
        atomic.name = "Atomic Chat (local)"
        warnings.push('Atomic Chat provider missing name field, auto-set to "Atomic Chat (local)"')
      }
      if (!atomic.options) {
        atomic.options = {}
        warnings.push("Atomic Chat provider missing options field, auto-created empty options")
      } else {
        if (!atomic.options.baseURL) {
          warnings.push("Atomic Chat provider missing baseURL, will use default")
        } else if (typeof atomic.options.baseURL !== "string") {
          errors.push("Atomic Chat provider baseURL must be a string")
        } else if (!isValidURL(atomic.options.baseURL)) {
          warnings.push("Atomic Chat provider baseURL may be invalid")
        }
      }

      if (atomic.models && typeof atomic.models !== "object") {
        errors.push("Atomic Chat provider models must be an object")
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}

function isValidURL(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}
