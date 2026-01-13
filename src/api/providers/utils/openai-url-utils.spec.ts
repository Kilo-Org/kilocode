import { describe, it, expect } from "vitest"

import {
	ensureHttps,
	normalizeOpenAiResponsesBaseUrl,
	isAzureOpenAiResourceHost,
	isAzureAiInferenceHost,
	getUrlHost,
} from "./openai-url-utils"

describe("openai-url-utils.ensureHttps", () => {
	it("keeps https URLs unchanged", () => {
		expect(ensureHttps("https://api.openai.com")).toBe("https://api.openai.com")
	})

	it("upgrades http URLs to https", () => {
		expect(ensureHttps("http://api.openai.com")).toBe("https://api.openai.com")
	})

	it("adds https scheme when missing", () => {
		expect(ensureHttps("api.openai.com")).toBe("https://api.openai.com")
	})

	it("trims whitespace before processing", () => {
		expect(ensureHttps("  myendpoint.openai.azure.com/  ")).toBe("https://myendpoint.openai.azure.com/")
	})

	it("returns empty string unchanged", () => {
		expect(ensureHttps("")).toBe("")
	})
})

describe("openai-url-utils host helpers", () => {
	it("detects Azure OpenAI resource hosts", () => {
		expect(isAzureOpenAiResourceHost("myendpoint.openai.azure.com")).toBe(true)
		expect(isAzureOpenAiResourceHost("myresource.cognitiveservices.azure.com")).toBe(true)
		expect(isAzureOpenAiResourceHost("api.openai.com")).toBe(false)
	})

	it("detects Azure AI Inference hosts", () => {
		expect(isAzureAiInferenceHost("myendpoint.services.ai.azure.com")).toBe(true)
		expect(isAzureAiInferenceHost("myendpoint.openai.azure.com")).toBe(false)
	})

	it("getUrlHost returns host for valid URLs and empty string for invalid ones", () => {
		expect(getUrlHost("https://api.openai.com/v1")).toBe("api.openai.com")
		expect(getUrlHost("not-a-url")).toBe("")
	})
})

describe("openai-url-utils.normalizeOpenAiResponsesBaseUrl - Azure hosts", () => {
	it("normalizes bare Azure openai host without scheme", () => {
		expect(normalizeOpenAiResponsesBaseUrl("myendpoint.openai.azure.com/")).toBe(
			"https://myendpoint.openai.azure.com/openai/v1/responses",
		)
	})

	it("normalizes https Azure openai host without path", () => {
		expect(normalizeOpenAiResponsesBaseUrl("https://myendpoint.openai.azure.com")).toBe(
			"https://myendpoint.openai.azure.com/openai/v1/responses",
		)
	})

	it("normalizes https Azure openai host with trailing slash", () => {
		expect(normalizeOpenAiResponsesBaseUrl("https://myendpoint.openai.azure.com/")).toBe(
			"https://myendpoint.openai.azure.com/openai/v1/responses",
		)
	})

	it("normalizes https Azure openai host with /openai", () => {
		expect(normalizeOpenAiResponsesBaseUrl("https://myendpoint.openai.azure.com/openai")).toBe(
			"https://myendpoint.openai.azure.com/openai/v1/responses",
		)
	})

	it("normalizes https Azure openai host with /openai/ (trailing slash)", () => {
		expect(normalizeOpenAiResponsesBaseUrl("https://myendpoint.openai.azure.com/openai/")).toBe(
			"https://myendpoint.openai.azure.com/openai/v1/responses",
		)
	})

	it("normalizes https Azure openai host with /openai/v1", () => {
		expect(normalizeOpenAiResponsesBaseUrl("https://myendpoint.openai.azure.com/openai/v1")).toBe(
			"https://myendpoint.openai.azure.com/openai/v1/responses",
		)
	})

	it("keeps full /openai/v1/responses URLs unchanged", () => {
		expect(normalizeOpenAiResponsesBaseUrl("https://myendpoint.openai.azure.com/openai/v1/responses")).toBe(
			"https://myendpoint.openai.azure.com/openai/v1/responses",
		)
	})

	it("handles cognitiveservices Azure domain like openai.azure.com", () => {
		expect(normalizeOpenAiResponsesBaseUrl("https://myresource.cognitiveservices.azure.com")).toBe(
			"https://myresource.cognitiveservices.azure.com/openai/v1/responses",
		)
	})
})

describe("openai-url-utils.normalizeOpenAiResponsesBaseUrl - generic providers", () => {
	it("appends /responses for generic host without responses suffix", () => {
		expect(normalizeOpenAiResponsesBaseUrl("https://custom.provider.com/api")).toBe(
			"https://custom.provider.com/api/responses",
		)
	})

	it("does not duplicate /responses suffix", () => {
		expect(normalizeOpenAiResponsesBaseUrl("https://custom.provider.com/api/responses")).toBe(
			"https://custom.provider.com/api/responses",
		)
	})

	it("uses /openai/v1/responses for api.openai.com", () => {
		expect(normalizeOpenAiResponsesBaseUrl("https://api.openai.com")).toBe(
			"https://api.openai.com/openai/v1/responses",
		)
	})
})

describe("openai-url-utils.normalizeOpenAiResponsesBaseUrl - query params", () => {
	it("drops Azure api-version when normalizing Azure URL", () => {
		expect(
			normalizeOpenAiResponsesBaseUrl("https://myendpoint.openai.azure.com/openai/v1?api-version=2024-05-01"),
		).toBe("https://myendpoint.openai.azure.com/openai/v1/responses")
	})

	it("preserves non-api-version query params while dropping api-version", () => {
		expect(
			normalizeOpenAiResponsesBaseUrl("https://myendpoint.openai.azure.com?foo=bar&api-version=2024-05-01"),
		).toBe("https://myendpoint.openai.azure.com/openai/v1/responses?foo=bar")
	})

	it("preserves query string for generic provider", () => {
		expect(normalizeOpenAiResponsesBaseUrl("https://custom.provider.com/api?foo=bar")).toBe(
			"https://custom.provider.com/api/responses?foo=bar",
		)
	})
})
