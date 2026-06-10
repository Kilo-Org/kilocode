/**
 * Local copies of constants previously imported from @kilocode/kilo-gateway.
 * These are defined here so that Bedrock-only mode does not require the
 * gateway package at runtime for constant values.
 */

export const HEADER_ORGANIZATIONID = "X-KILOCODE-ORGANIZATIONID"
export const HEADER_TASKID = "X-KILOCODE-TASKID"
export const HEADER_PARENT_TASKID = "X-KILOCODE-PARENT-TASKID"
export const HEADER_PROJECTID = "X-KILOCODE-PROJECTID"
export const HEADER_TESTER = "X-KILOCODE-TESTER"
export const HEADER_EDITORNAME = "X-KILOCODE-EDITORNAME"
export const HEADER_MACHINEID = "X-KILOCODE-MACHINEID"
export const HEADER_FEATURE = "X-KILOCODE-FEATURE"
export const ENV_FEATURE = "KILOCODE_FEATURE"
export const ENV_VERSION = "KILOCODE_VERSION"
export const KILO_API_BASE = "https://api.kilo.ai"
export const KILO_OPENROUTER_BASE = `${KILO_API_BASE}/api/openrouter`

export const PROMPTS = [
  "codex",
  "gemini",
  "beast",
  "anthropic",
  "trinity",
  "anthropic_without_todo",
  "ling",
  "gpt55",
] as const

export const AI_SDK_PROVIDERS = [
  "alibaba",
  "anthropic",
  "mistral",
  "openai",
  "openai-compatible",
  "openrouter",
] as const
