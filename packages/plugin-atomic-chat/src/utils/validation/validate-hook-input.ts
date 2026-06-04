import type { ValidationResult } from './validation-result'

export function validateHookInput(hookName: string, input: any): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!input || typeof input !== 'object') {
    errors.push(`${hookName}: Input must be an object`)
    return { isValid: false, errors, warnings }
  }

  switch (hookName) {
    case 'chat.params':
      if (!input.sessionID || typeof input.sessionID !== 'string') {
        errors.push('chat.params: sessionID is required and must be a string')
      }
      if (!input.model || typeof input.model !== 'object') {
        errors.push('chat.params: model is required and must be an object')
      } else {
        if (!input.model.id || typeof input.model.id !== 'string') {
          errors.push('chat.params: model.id is required and must be a string')
        }
      }
      if (!input.provider || typeof input.provider !== 'object') {
        errors.push('chat.params: provider is required and must be an object')
      } else {
        if (!input.provider.info || !input.provider.info.id) {
          warnings.push('chat.params: provider.info.id is missing')
        }
      }
      break

    case 'event':
      if (!input.event || typeof input.event !== 'object') {
        errors.push('event: event is required and must be an object')
      } else if (!input.event.type) {
        warnings.push('event: event.type is missing')
      }
      break
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}
