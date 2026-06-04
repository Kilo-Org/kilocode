import type { ModelValidationError, AutoFixSuggestion, SimilarModel } from '../types'
import { LOG_PREFIX } from '../constants'

export { formatModelName, extractModelOwner } from './format-model-name'

export function categorizeModel(modelId: string): 'chat' | 'embedding' | 'unknown' {
  const lowerId = modelId.toLowerCase()
  if (lowerId.includes('embedding') || lowerId.includes('embed')) {
    return 'embedding'
  }
  if (
    lowerId.includes('gpt') ||
    lowerId.includes('llama') ||
    lowerId.includes('claude') ||
    lowerId.includes('qwen') ||
    lowerId.includes('mistral') ||
    lowerId.includes('gemma') ||
    lowerId.includes('phi') ||
    lowerId.includes('falcon') ||
    lowerId.includes('deepseek')
  ) {
    return 'chat'
  }
  return 'unknown'
}

export function findSimilarModels(targetModel: string, availableModels: string[]): SimilarModel[] {
  const target = targetModel.toLowerCase()
  const targetTokens = target.split(/[-_\s]/).filter(Boolean)

  return availableModels
    .map((model) => {
      const candidate = model.toLowerCase()
      const candidateTokens = candidate.split(/[-_\s]/).filter(Boolean)
      let similarity = 0
      const reasons: string[] = []

      if (candidate === target) {
        similarity = 1.0
        reasons.push('Exact match')
      }

      const targetPrefix = targetTokens[0]
      const candidatePrefix = candidateTokens[0]
      if (targetPrefix && candidatePrefix && targetPrefix === candidatePrefix) {
        similarity += 0.5
        reasons.push(`Same family: ${targetPrefix}`)
      }

      const commonSuffixes = ['3b', '7b', '13b', '70b', 'q4', 'q8', 'instruct', 'chat', 'base']
      for (const suffix of commonSuffixes) {
        if (target.includes(suffix) && candidate.includes(suffix)) {
          similarity += 0.2
          reasons.push(`Shared suffix: ${suffix}`)
        }
      }

      const commonTokens = targetTokens.filter((token) => candidateTokens.includes(token))
      if (commonTokens.length > 0) {
        similarity += (commonTokens.length / Math.max(targetTokens.length, candidateTokens.length)) * 0.3
        reasons.push(`Common tokens: ${commonTokens.join(', ')}`)
      }

      return {
        model,
        similarity: Math.min(similarity, 1.0),
        reason: reasons.join(', '),
      }
    })
    .filter((item) => item.similarity > 0.1)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5)
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000
): Promise<{ success: boolean; result?: T; error?: string }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await operation()
      return { success: true, result }
    } catch (error) {
      if (attempt === maxAttempts - 1) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
      const delay = baseDelay * Math.pow(2, attempt)
      console.warn(`${LOG_PREFIX} Retrying operation after ${delay}ms`, {
        attempt: attempt + 1,
        maxAttempts,
        error: error instanceof Error ? error.message : String(error),
      })
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  return { success: false, error: 'Max attempts exceeded' }
}

export function categorizeError(error: unknown, context: { baseURL: string; modelId: string }): ModelValidationError {
  const errorStr = String(error).toLowerCase()
  const { baseURL, modelId } = context

  if (
    errorStr.includes('econnrefused') ||
    errorStr.includes('fetch failed') ||
    errorStr.includes('failed to fetch') ||
    errorStr.includes('network')
  ) {
    return {
      type: 'offline',
      severity: 'critical',
      message: `Cannot reach Atomic Chat at ${baseURL}. Start Atomic Chat and enable the local OpenAI-compatible server.`,
      canRetry: true,
      autoFixAvailable: true,
    }
  }

  if (errorStr.includes('timeout') || errorStr.includes('aborted')) {
    return {
      type: 'timeout',
      severity: 'medium',
      message: `Request to Atomic Chat timed out.`,
      canRetry: true,
      autoFixAvailable: false,
    }
  }

  if (
    errorStr.includes('404') ||
    errorStr.includes('not found') ||
    errorStr.includes('not loaded')
  ) {
    return {
      type: 'not_found',
      severity: 'high',
      message: `Model '${modelId}' is not loaded in Atomic Chat. Load it and confirm GET /v1/models lists it.`,
      canRetry: false,
      autoFixAvailable: false,
    }
  }

  if (errorStr.includes('401') || errorStr.includes('403') || errorStr.includes('unauthorized')) {
    return {
      type: 'permission',
      severity: 'high',
      message: `Authentication or permission issue with Atomic Chat.`,
      canRetry: false,
      autoFixAvailable: false,
    }
  }

  return {
    type: 'unknown',
    severity: 'medium',
    message: `Unexpected error: ${errorStr}`,
    canRetry: true,
    autoFixAvailable: false,
  }
}

export function generateAutoFixSuggestions(errorCategory: ModelValidationError): AutoFixSuggestion[] {
  const suggestions: AutoFixSuggestion[] = []

  switch (errorCategory.type) {
    case 'offline':
      suggestions.push({
        action: 'Start Atomic Chat',
        steps: [
          '1. Open the Atomic Chat application',
          '2. Ensure the local API server is running (default http://127.0.0.1:1337/v1)',
          '3. Check firewall settings if the port is blocked',
        ],
        automated: false,
      })
      break
    case 'not_found':
      suggestions.push({
        action: 'Load a model in Atomic Chat',
        steps: [
          '1. Open Atomic Chat',
          '2. Download or select a model and load it',
          '3. Run curl http://127.0.0.1:1337/v1/models to verify the model id',
          '4. Retry in Kilo Code',
        ],
        automated: false,
      })
      break
    case 'timeout':
      suggestions.push({
        action: 'Retry or reduce load',
        steps: [
          '1. Try a smaller / faster model',
          '2. Close other heavy apps',
          '3. Retry the request',
        ],
        automated: false,
      })
      break
  }

  return suggestions
}
