import { Tiktoken, encodingForModel as _encodingForModel } from "js-tiktoken"
import type { MessageContent } from "../index.js"
import { llamaTokenizer } from "./llamaTokenizer.js"

interface Encoding {
  encode: Tiktoken["encode"]
  decode: Tiktoken["decode"]
}

class LlamaEncoding implements Encoding {
  encode(text: string): number[] {
    return llamaTokenizer.encode(text)
  }

  decode(tokens: number[]): string {
    return llamaTokenizer.decode(tokens)
  }
}

let gptEncoding: Encoding | null = null
const llamaEncoding = new LlamaEncoding()

function modelUsesGptTokenizer(modelName: string): boolean {
  const name = (modelName || "").toLowerCase()
  const patterns: (RegExp | string)[] = [
    /^gpt/,
    /^o3/,
    /^o4/,
    "command-r",
    "aya",
    "chat-bison",
    "pplx",
    "gemini",
    "grok",
    "moonshot",
    "mercury",
    "claude",
    "codestral",
    "nova",
  ]
  return patterns.some((p) => (typeof p === "string" ? name.includes(p) : p.test(name)))
}

export function encodingForModel(modelName: string): Encoding {
  if (!modelUsesGptTokenizer(modelName)) return llamaEncoding
  return (gptEncoding ??= _encodingForModel("gpt-4"))
}

export function countTokens(
  content: MessageContent,
  // defaults to llama2 because the tokenizer tends to produce more tokens
  modelName = "llama2",
): number {
  const encoding = encodingForModel(modelName)
  if (Array.isArray(content)) {
    return content.reduce((acc, part) => {
      return acc + encoding.encode(part.text ?? "", "all", []).length
    }, 0)
  }
  return encoding.encode(content ?? "", "all", []).length
}

export function pruneLinesFromTop(prompt: string, maxTokens: number, modelName: string): string {
  const lines = prompt.split("\n")
  const lineTokens = lines.map((line) => countTokens(line, modelName))
  let totalTokens = lineTokens.reduce((sum, tokens) => sum + tokens, 0)
  let start = 0
  const currentLines = lines.length

  totalTokens += Math.max(0, currentLines - 1)

  while (totalTokens > maxTokens && start < currentLines) {
    totalTokens -= lineTokens[start] ?? 0
    if (currentLines - start > 1) {
      totalTokens--
    }
    start++
  }

  return lines.slice(start).join("\n")
}

export function pruneLinesFromBottom(prompt: string, maxTokens: number, modelName: string): string {
  const lines = prompt.split("\n")
  const lineTokens = lines.map((line) => countTokens(line, modelName))
  let totalTokens = lineTokens.reduce((sum, tokens) => sum + tokens, 0)
  let end = lines.length

  totalTokens += Math.max(0, end - 1)

  while (totalTokens > maxTokens && end > 0) {
    end--
    totalTokens -= lineTokens[end] ?? 0
    if (end > 0) {
      totalTokens--
    }
  }

  return lines.slice(0, end).join("\n")
}

export function pruneStringFromBottom(modelName: string, maxTokens: number, prompt: string): string {
  const encoding = encodingForModel(modelName)
  const tokens = encoding.encode(prompt, "all", [])
  if (tokens.length <= maxTokens) {
    return prompt
  }
  return encoding.decode(tokens.slice(0, maxTokens))
}
