// npx vitest run api/transform/__tests__/image-cleaning.spec.ts

import type { ModelInfo } from "@roo-code/types"

import { ApiHandler } from "../../index"
import { ApiMessage } from "../../../core/task-persistence/apiMessages"
import { maybeRemoveImageBlocks } from "../image-cleaning"

describe("maybeRemoveImageBlocks", () => {
	// Mock ApiHandler factory function
	const createMockApiHandler = (supportsImages: boolean): ApiHandler => {
		return {
			// kilocode_change start
			fetchModel: vitest.fn().mockReturnValue(
				Promise.resolve({
					id: "test-model",
					info: {
						supportsImages,
					} as ModelInfo,
				}),
			),
			// kilocode_change end
			createMessage: vitest.fn(),
			countTokens: vitest.fn(),
		}
	}

	it("should handle empty messages array", async () => {
		const apiHandler = createMockApiHandler(true)
		const messages: ApiMessage[] = []

		const result = await maybeRemoveImageBlocks(messages, apiHandler)

		expect(result).toEqual([])
		// No need to check if getModel was called since there are no messages to process
	})

	it("should not modify messages with no image blocks", async () => {
		const apiHandler = createMockApiHandler(true)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: "Hello, world!",
			},
			{
				role: "assistant",
				content: "Hi there!",
			},
		]

		const result = await maybeRemoveImageBlocks(messages, apiHandler)

		expect(result).toEqual(messages)
		// getModel is only called when content is an array, which is not the case here
	})

	it("should not modify messages with array content but no image blocks", async () => {
		const apiHandler = createMockApiHandler(true)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Hello, world!",
					},
					{
						type: "text",
						text: "How are you?",
					},
				],
			},
		]

		const result = await maybeRemoveImageBlocks(messages, apiHandler)

		expect(result).toEqual(messages)
		expect(apiHandler.fetchModel).toHaveBeenCalled() // kilocode_change
	})

	it("should not modify image blocks when API handler supports images", async () => {
		const apiHandler = createMockApiHandler(true)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Check out this image:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "base64-encoded-image-data",
						},
					},
				],
			},
		]

		const result = await maybeRemoveImageBlocks(messages, apiHandler)

		// Should not modify the messages since the API handler supports images
		expect(result).toEqual(messages)
		expect(apiHandler.fetchModel).toHaveBeenCalled() // kilocode_change
	})

	it("should convert image blocks to text descriptions when API handler doesn't support images", async () => {
		const apiHandler = createMockApiHandler(false)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Check out this image:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "base64-encoded-image-data",
						},
					},
				],
			},
		]

		const result = await maybeRemoveImageBlocks(messages, apiHandler)

		// Should convert image blocks to text descriptions
		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Check out this image:",
					},
					{
						type: "text",
						text: "[Referenced image in conversation]",
					},
				],
			},
		])
		expect(apiHandler.fetchModel).toHaveBeenCalled() // kilocode_change
	})

	it("should handle mixed content messages with multiple text and image blocks", async () => {
		const apiHandler = createMockApiHandler(false)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here are some images:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "image-data-1",
						},
					},
					{
						type: "text",
						text: "And another one:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/png",
							data: "image-data-2",
						},
					},
				],
			},
		]

		const result = await maybeRemoveImageBlocks(messages, apiHandler)

		// Should convert all image blocks to text descriptions
		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here are some images:",
					},
					{
						type: "text",
						text: "[Referenced image in conversation]",
					},
					{
						type: "text",
						text: "And another one:",
					},
					{
						type: "text",
						text: "[Referenced image in conversation]",
					},
				],
			},
		])
		expect(apiHandler.fetchModel).toHaveBeenCalled() // kilocode_change
	})

	it("should handle multiple messages with image blocks", async () => {
		const apiHandler = createMockApiHandler(false)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's an image:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "image-data-1",
						},
					},
				],
			},
			{
				role: "assistant",
				content: "I see the image!",
			},
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's another image:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/png",
							data: "image-data-2",
						},
					},
				],
			},
		]

		const result = await maybeRemoveImageBlocks(messages, apiHandler)

		// Should convert all image blocks to text descriptions
		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's an image:",
					},
					{
						type: "text",
						text: "[Referenced image in conversation]",
					},
				],
			},
			{
				role: "assistant",
				content: "I see the image!",
			},
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's another image:",
					},
					{
						type: "text",
						text: "[Referenced image in conversation]",
					},
				],
			},
		])
		expect(apiHandler.fetchModel).toHaveBeenCalled() // kilocode_change
	})

	it("should preserve additional message properties", async () => {
		const apiHandler = createMockApiHandler(false)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's an image:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "image-data",
						},
					},
				],
				ts: 1620000000000,
				isSummary: true,
			},
		]

		const result = await maybeRemoveImageBlocks(messages, apiHandler)

		// Should convert image blocks to text descriptions while preserving additional properties
		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's an image:",
					},
					{
						type: "text",
						text: "[Referenced image in conversation]",
					},
				],
				ts: 1620000000000,
				isSummary: true,
			},
		])
		expect(apiHandler.fetchModel).toHaveBeenCalled() // kilocode_change
	})
})
