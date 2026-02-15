import { Tiktoken, encodingForModel as _encodingForModel } from "js-tiktoken"
import { ChatMessage, CompiledMessagesResult, MessageContent } from "../index.js"
import { addSpaceToAnyEmptyMessages, chatMessageIsEmpty } from "./messages.js"
import { DEFAULT_PRUNING_LENGTH } from "./constants.js"
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

function countTokens(
	content: MessageContent,
	// defaults to llama2 because the tokenizer tends to produce more tokens
	modelName = "llama2",
): number {
	const encoding = encodingForModel(modelName)
	if (Array.isArray(content)) {
		return content.reduce((acc, part) => {
			return acc + encoding.encode(part.text ?? "", "all", []).length
		}, 0)
	} else {
		return encoding.encode(content ?? "", "all", []).length
	}
}

function countChatMessageTokens(modelName: string, chatMessage: ChatMessage): number {
	// Doing simpler, safer version of what is here:
	// https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb
	// every message follows <|im_start|>{role/name}\n{content}<|end|>\n
	const BASE_TOKENS = 4
	let tokens = BASE_TOKENS

	if (chatMessage.content) {
		tokens += countTokens(chatMessage.content, modelName)
	}

	return tokens
}

/**
 * Extracts and validates the user message from the end of a message array.
 *
 * @param messages - Array of chat messages (will be modified by popping messages)
 * @returns Array of messages that form the tool sequence
 */
function extractToolSequence(messages: ChatMessage[]): ChatMessage[] {
	const lastMsg = messages.pop()
	if (!lastMsg || lastMsg.role !== "user") {
		throw new Error("Error parsing chat history: no user message found")
	}

	const toolSequence: ChatMessage[] = [lastMsg]

	return toolSequence
}

function pruneLinesFromTop(prompt: string, maxTokens: number, modelName: string): string {
	const lines = prompt.split("\n")
	// Preprocess tokens for all lines and cache them.
	const lineTokens = lines.map((line) => countTokens(line, modelName))
	let totalTokens = lineTokens.reduce((sum, tokens) => sum + tokens, 0)
	let start = 0
	const currentLines = lines.length

	// Calculate initial token count including newlines
	totalTokens += Math.max(0, currentLines - 1) // Add tokens for joining newlines

	// Using indexes instead of array modifications.
	// Remove lines from the top until the token count is within the limit.
	while (totalTokens > maxTokens && start < currentLines) {
		totalTokens -= lineTokens[start]
		// Decrement token count for the removed line and its preceding/joining newline (if not the last line)
		if (currentLines - start > 1) {
			totalTokens--
		}
		start++
	}

	return lines.slice(start).join("\n")
}

function pruneLinesFromBottom(prompt: string, maxTokens: number, modelName: string): string {
	const lines = prompt.split("\n")
	const lineTokens = lines.map((line) => countTokens(line, modelName))
	let totalTokens = lineTokens.reduce((sum, tokens) => sum + tokens, 0)
	let end = lines.length

	// Calculate initial token count including newlines
	totalTokens += Math.max(0, end - 1) // Add tokens for joining newlines

	// Reverse traversal to avoid array modification
	// Remove lines from the bottom until the token count is within the limit.
	while (totalTokens > maxTokens && end > 0) {
		end--
		totalTokens -= lineTokens[end]
		// Decrement token count for the removed line and its following/joining newline (if not the first line)
		if (end > 0) {
			totalTokens--
		}
	}

	return lines.slice(0, end).join("\n")
}

function pruneStringFromBottom(modelName: string, maxTokens: number, prompt: string): string {
	const encoding = encodingForModel(modelName)

	const tokens = encoding.encode(prompt, "all", [])
	if (tokens.length <= maxTokens) {
		return prompt
	}

	return encoding.decode(tokens.slice(0, maxTokens))
}

function pruneStringFromTop(modelName: string, maxTokens: number, prompt: string): string {
	const encoding = encodingForModel(modelName)

	const tokens = encoding.encode(prompt, "all", [])
	if (tokens.length <= maxTokens) {
		return prompt
	}

	return encoding.decode(tokens.slice(tokens.length - maxTokens))
}

const MAX_TOKEN_SAFETY_BUFFER = 1000
const TOKEN_SAFETY_PROPORTION = 0.02
export function getTokenCountingBufferSafety(contextLength: number) {
	return Math.min(MAX_TOKEN_SAFETY_BUFFER, contextLength * TOKEN_SAFETY_PROPORTION)
}

const MIN_RESPONSE_TOKENS = 1000

function pruneRawPromptFromTop(
	modelName: string,
	contextLength: number,
	prompt: string,
	tokensForCompletion: number,
): string {
	const maxTokens = contextLength - tokensForCompletion - getTokenCountingBufferSafety(contextLength)
	return pruneStringFromTop(modelName, maxTokens, prompt)
}

/**
 * Reconciles chat messages with available context length by intelligently pruning older messages
 * while preserving critical conversation elements.
 *
 * Core Guidelines:
 * - Always preserve the last user/tool message sequence (including any associated assistant message with tool calls)
 * - Always preserve the system message and tools
 * - Never allow orphaned tool responses without their corresponding tool calls
 * - Remove older messages first when pruning is necessary
 * - Maintain conversation coherence by flattening adjacent similar messages
 *
 * Process:
 * 1. Handle image content conversion for models that don't support images
 * 2. Extract and preserve system message
 * 3. Filter out empty messages and trailing non-user/tool messages
 * 4. Extract the complete tool sequence from the end (user message or assistant + tool responses)
 * 5. Calculate token requirements for non-negotiable elements (system, tools, last sequence)
 * 6. Prune older messages until within available token budget
 * 7. Reassemble with proper ordering and flatten adjacent similar messages
 *
 * @param params - Configuration object containing:
 *   - modelName: LLM model name for token counting
 *   - msgs: Array of chat messages to process
 *   - contextLength: Maximum context length supported by the model
 *   - maxTokens: Maximum tokens to reserve for the response
 * @returns Processed array of chat messages that fit within context constraints
 * @throws Error if non-negotiable elements exceed available context
 */
function compileChatMessages({
	modelName,
	msgs,
	knownContextLength,
	maxTokens,
}: {
	modelName: string
	msgs: ChatMessage[]
	knownContextLength: number | undefined
	maxTokens: number
}): CompiledMessagesResult {
	let didPrune = false

	let msgsCopy: ChatMessage[] = msgs.map((m) => ({ ...m }))

	// Extract system message
	const systemMsg = msgsCopy.find((msg) => msg.role === "system")
	msgsCopy = msgsCopy.filter((msg) => msg.role !== "system")

	// Remove any empty messages or non-user/tool trailing messages
	msgsCopy = msgsCopy.filter((msg) => !chatMessageIsEmpty(msg))

	msgsCopy = addSpaceToAnyEmptyMessages(msgsCopy)

	// Extract the tool sequence from the end of the message array
	const toolSequence = extractToolSequence(msgsCopy)

	// Count tokens for all messages in the tool sequence
	let lastMessagesTokens = 0
	for (const msg of toolSequence) {
		lastMessagesTokens += countChatMessageTokens(modelName, msg)
	}

	// System message
	let systemMsgTokens = 0
	if (systemMsg) {
		systemMsgTokens = countChatMessageTokens(modelName, systemMsg)
	}

	const contextLength = knownContextLength ?? DEFAULT_PRUNING_LENGTH
	const countingSafetyBuffer = getTokenCountingBufferSafety(contextLength)
	const minOutputTokens = Math.min(MIN_RESPONSE_TOKENS, maxTokens)

	let inputTokensAvailable = contextLength

	// Leave space for output/safety
	inputTokensAvailable -= countingSafetyBuffer
	inputTokensAvailable -= minOutputTokens

	// Non-negotiable messages
	inputTokensAvailable -= systemMsgTokens
	inputTokensAvailable -= lastMessagesTokens

	// Make sure there's enough context for the non-excludable items
	if (knownContextLength !== undefined && inputTokensAvailable < 0) {
		throw new Error(
			`Not enough context available to include the system message, last user message, and tools.
        There must be at least ${minOutputTokens} tokens remaining for output.
        Request had the following token counts:
        - contextLength: ${knownContextLength}
        - counting safety buffer: ${countingSafetyBuffer}
        - system message: ~${systemMsgTokens}
        - max output tokens: ${maxTokens}`,
		)
	}

	// Now remove messages till we're under the limit
	let currentTotal = 0
	const historyWithTokens = msgsCopy.map((message) => {
		const tokens = countChatMessageTokens(modelName, message)
		currentTotal += tokens
		return {
			...message,
			tokens,
		}
	})

	while (historyWithTokens.length > 0 && currentTotal > inputTokensAvailable) {
		const message = historyWithTokens.shift()!
		currentTotal -= message.tokens
		didPrune = true
	}

	// Now reassemble
	const reassembled: ChatMessage[] = []
	if (systemMsg) {
		reassembled.push(systemMsg)
	}
	reassembled.push(...historyWithTokens.map(({ tokens: _tokens, ...rest }) => rest))
	reassembled.push(...toolSequence)

	const inputTokens = currentTotal + systemMsgTokens + lastMessagesTokens
	const availableTokens = contextLength - countingSafetyBuffer - minOutputTokens
	const contextPercentage = inputTokens / availableTokens
	return {
		compiledChatMessages: reassembled,
		didPrune,
		contextPercentage,
	}
}

export {
	compileChatMessages,
	countTokens,
	pruneLinesFromBottom,
	pruneLinesFromTop,
	pruneRawPromptFromTop,
	pruneStringFromBottom,
}
