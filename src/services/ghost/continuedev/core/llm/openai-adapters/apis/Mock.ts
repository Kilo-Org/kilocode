import {
	ChatCompletion,
	ChatCompletionChunk,
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionCreateParamsStreaming,
	Completion,
	CompletionCreateParamsNonStreaming,
	CompletionCreateParamsStreaming,
	Model,
} from "openai/resources/index"
import { chatChunk, chatCompletion } from "../util.js"
import { BaseLlmApi, CreateRerankResponse, FimCreateParamsStreaming, RerankCreateParams } from "./base.js"

const MOCK_RESPONSE =
	"This is a mock response from the OpenAI API. It can be returned all at once or streamed chunk by chunk."

export class MockApi implements BaseLlmApi {
	async chatCompletionNonStream(
		body: ChatCompletionCreateParamsNonStreaming,
		_signal: AbortSignal,
	): Promise<ChatCompletion> {
		await new Promise((resolve) => setTimeout(resolve, 800))
		const lastMessage = body.messages[body.messages.length - 1].content
		const content = !lastMessage
			? MOCK_RESPONSE
			: typeof lastMessage === "string"
				? lastMessage
				: lastMessage[0].type === "text"
					? lastMessage[0].text
					: MOCK_RESPONSE
		return chatCompletion({
			content,
			model: body.model,
		})
	}

	async *chatCompletionStream(
		body: ChatCompletionCreateParamsStreaming,
		_signal: AbortSignal,
	): AsyncGenerator<ChatCompletionChunk, any, unknown> {
		const lastMessage = body.messages[body.messages.length - 1].content
		const content = !lastMessage
			? MOCK_RESPONSE
			: typeof lastMessage === "string"
				? lastMessage
				: lastMessage[0].type === "text"
					? lastMessage[0].text
					: MOCK_RESPONSE
		const chunks = content.split(" ")
		for (const chunk of chunks) {
			await new Promise((resolve) => setTimeout(resolve, 100))
			yield chatChunk({
				content: chunk + " ",
				model: body.model,
			})
		}
	}

	async completionNonStream(body: CompletionCreateParamsNonStreaming, _signal: AbortSignal): Promise<Completion> {
		await new Promise((resolve) => setTimeout(resolve, 800))
		return {
			id: "mock-completion",
			object: "text_completion",
			created: Date.now(),
			model: body.model,
			choices: [
				{
					text: body.prompt as string,
					index: 0,
					finish_reason: "stop",
				},
			],
		} as Completion
	}

	async *completionStream(
		body: CompletionCreateParamsStreaming,
		_signal: AbortSignal,
	): AsyncGenerator<Completion, any, unknown> {
		const chunks = (body.prompt as string).split(" ")
		for (const chunk of chunks) {
			await new Promise((resolve) => setTimeout(resolve, 100))
			yield {
				id: "mock-chunk",
				object: "text_completion",
				created: Date.now(),
				model: body.model,
				choices: [
					{
						text: chunk + " ",
						index: 0,
						finish_reason: "stop",
					},
				],
			} as Completion
		}
	}

	async *fimStream(
		body: FimCreateParamsStreaming,
		_signal: AbortSignal,
	): AsyncGenerator<ChatCompletionChunk, any, unknown> {
		const chunks = (body.prompt as string).split(" ")
		for (const chunk of chunks) {
			await new Promise((resolve) => setTimeout(resolve, 100))
			yield chatChunk({
				content: chunk + " ",
				model: body.model,
			})
		}
	}

	async rerank(_body: RerankCreateParams): Promise<CreateRerankResponse> {
		throw new Error("Method not implemented.")
	}

	async list(): Promise<Model[]> {
		return [
			{
				id: "mock-model",
				created: Date.now(),
				object: "model",
				owned_by: "mock",
			},
		]
	}
}
