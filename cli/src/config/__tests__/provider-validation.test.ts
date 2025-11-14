import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { envConfigExists, getMissingEnvVars, getRequiredEnvVars } from "../provider-validation.js"

describe("envConfigExists", () => {
	const originalEnv = process.env

	beforeEach(() => {
		process.env = { ...originalEnv }
	})

	afterEach(() => {
		process.env = originalEnv
	})

	it("should return true when KILO_PROVIDER_TYPE is set", () => {
		process.env.KILO_PROVIDER_TYPE = "anthropic"
		expect(envConfigExists()).toBe(true)
	})

	it("should return false when KILO_PROVIDER_TYPE is not set", () => {
		delete process.env.KILO_PROVIDER_TYPE
		expect(envConfigExists()).toBe(false)
	})
})

describe("getRequiredEnvVars", () => {
	it("should return required vars for kilocode provider", () => {
		const required = getRequiredEnvVars("kilocode")
		expect(required).toEqual(["KILOCODE_TOKEN", "KILOCODE_MODEL"])
	})

	it("should return required vars for anthropic provider", () => {
		const required = getRequiredEnvVars("anthropic")
		expect(required).toEqual(["KILO_API_KEY", "KILO_API_MODEL_ID"])
	})

	it("should return required vars for openai-native provider", () => {
		const required = getRequiredEnvVars("openai-native")
		expect(required).toEqual(["KILO_OPENAI_NATIVE_API_KEY", "KILO_API_MODEL_ID"])
	})

	it("should return required vars for openai provider", () => {
		const required = getRequiredEnvVars("openai")
		expect(required).toEqual(["KILO_OPENAI_API_KEY", "KILO_OPENAI_MODEL_ID"])
	})

	it("should return required vars for openrouter provider", () => {
		const required = getRequiredEnvVars("openrouter")
		expect(required).toEqual(["KILO_OPENROUTER_API_KEY", "KILO_OPENROUTER_MODEL_ID"])
	})

	it("should return required vars for ollama provider", () => {
		const required = getRequiredEnvVars("ollama")
		expect(required).toEqual(["KILO_OLLAMA_MODEL_ID"])
	})

	it("should return required vars for bedrock provider", () => {
		const required = getRequiredEnvVars("bedrock")
		expect(required).toEqual([
			"KILO_API_MODEL_ID",
			"KILO_AWS_REGION",
			"KILO_AWS_ACCESS_KEY + KILO_AWS_SECRET_KEY (or KILO_AWS_PROFILE or KILO_AWS_API_KEY)",
		])
	})

	it("should return required vars for vertex provider", () => {
		const required = getRequiredEnvVars("vertex")
		expect(required).toEqual([
			"KILO_API_MODEL_ID",
			"KILO_VERTEX_PROJECT_ID",
			"KILO_VERTEX_REGION",
			"KILO_VERTEX_KEY_FILE or KILO_VERTEX_JSON_CREDENTIALS",
		])
	})

	it("should return required vars for gemini provider", () => {
		const required = getRequiredEnvVars("gemini")
		expect(required).toEqual(["KILO_GEMINI_API_KEY", "KILO_API_MODEL_ID"])
	})

	it("should return required vars for mistral provider", () => {
		const required = getRequiredEnvVars("mistral")
		expect(required).toEqual(["KILO_MISTRAL_API_KEY", "KILO_API_MODEL_ID"])
	})

	it("should return required vars for groq provider", () => {
		const required = getRequiredEnvVars("groq")
		expect(required).toEqual(["KILO_GROQ_API_KEY", "KILO_API_MODEL_ID"])
	})

	it("should return required vars for deepseek provider", () => {
		const required = getRequiredEnvVars("deepseek")
		expect(required).toEqual(["KILO_DEEPSEEK_API_KEY", "KILO_API_MODEL_ID"])
	})

	it("should return required vars for xai provider", () => {
		const required = getRequiredEnvVars("xai")
		expect(required).toEqual(["KILO_XAI_API_KEY", "KILO_API_MODEL_ID"])
	})

	it("should return default required vars for unknown provider", () => {
		const required = getRequiredEnvVars("unknown")
		expect(required).toEqual(["KILO_API_KEY"])
	})
})

describe("getMissingEnvVars", () => {
	const originalEnv = process.env

	beforeEach(() => {
		process.env = { ...originalEnv }
		// Clear all relevant env vars
		delete process.env.KILOCODE_TOKEN
		delete process.env.KILOCODE_MODEL
		delete process.env.KILO_API_KEY
		delete process.env.KILO_API_MODEL_ID
		delete process.env.KILO_OPENAI_NATIVE_API_KEY
		delete process.env.KILO_OPENAI_API_KEY
		delete process.env.KILO_OPENAI_MODEL_ID
		delete process.env.KILO_OPENROUTER_API_KEY
		delete process.env.KILO_OPENROUTER_MODEL_ID
		delete process.env.KILO_OLLAMA_MODEL_ID
		delete process.env.KILO_AWS_REGION
		delete process.env.KILO_AWS_ACCESS_KEY
		delete process.env.KILO_AWS_SECRET_KEY
		delete process.env.KILO_AWS_PROFILE
		delete process.env.KILO_AWS_USE_PROFILE
		delete process.env.KILO_AWS_API_KEY
		delete process.env.KILO_AWS_USE_API_KEY
		delete process.env.KILO_VERTEX_PROJECT_ID
		delete process.env.KILO_VERTEX_REGION
		delete process.env.KILO_VERTEX_KEY_FILE
		delete process.env.KILO_VERTEX_JSON_CREDENTIALS
		delete process.env.KILO_GEMINI_API_KEY
		delete process.env.KILO_MISTRAL_API_KEY
		delete process.env.KILO_GROQ_API_KEY
		delete process.env.KILO_DEEPSEEK_API_KEY
		delete process.env.KILO_XAI_API_KEY
	})

	afterEach(() => {
		process.env = originalEnv
	})

	describe("kilocode provider", () => {
		it("should return all missing vars when none are set", () => {
			const missing = getMissingEnvVars("kilocode")
			expect(missing).toEqual(["KILOCODE_TOKEN", "KILOCODE_MODEL"])
		})

		it("should return only missing vars when some are set", () => {
			process.env.KILOCODE_TOKEN = "test-token"
			const missing = getMissingEnvVars("kilocode")
			expect(missing).toEqual(["KILOCODE_MODEL"])
		})

		it("should return empty array when all vars are set", () => {
			process.env.KILOCODE_TOKEN = "test-token"
			process.env.KILOCODE_MODEL = "test-model"
			const missing = getMissingEnvVars("kilocode")
			expect(missing).toEqual([])
		})
	})

	describe("anthropic provider", () => {
		it("should return all missing vars when none are set", () => {
			const missing = getMissingEnvVars("anthropic")
			expect(missing).toEqual(["KILO_API_KEY", "KILO_API_MODEL_ID"])
		})

		it("should return empty array when all vars are set", () => {
			process.env.KILO_API_KEY = "test-key"
			process.env.KILO_API_MODEL_ID = "test-model"
			const missing = getMissingEnvVars("anthropic")
			expect(missing).toEqual([])
		})
	})

	describe("bedrock provider", () => {
		it("should return all missing vars when none are set", () => {
			const missing = getMissingEnvVars("bedrock")
			expect(missing).toEqual([
				"KILO_API_MODEL_ID",
				"KILO_AWS_REGION",
				"KILO_AWS_ACCESS_KEY + KILO_AWS_SECRET_KEY (or KILO_AWS_PROFILE or KILO_AWS_API_KEY)",
			])
		})

		it("should not report auth missing when AWS keys are set", () => {
			process.env.KILO_API_MODEL_ID = "test-model"
			process.env.KILO_AWS_REGION = "us-east-1"
			process.env.KILO_AWS_ACCESS_KEY = "test-access-key"
			process.env.KILO_AWS_SECRET_KEY = "test-secret-key"
			const missing = getMissingEnvVars("bedrock")
			expect(missing).toEqual([])
		})

		it("should not report auth missing when AWS profile is set", () => {
			process.env.KILO_API_MODEL_ID = "test-model"
			process.env.KILO_AWS_REGION = "us-east-1"
			process.env.KILO_AWS_USE_PROFILE = "true"
			process.env.KILO_AWS_PROFILE = "default"
			const missing = getMissingEnvVars("bedrock")
			expect(missing).toEqual([])
		})

		it("should not report auth missing when AWS API key is set", () => {
			process.env.KILO_API_MODEL_ID = "test-model"
			process.env.KILO_AWS_REGION = "us-east-1"
			process.env.KILO_AWS_USE_API_KEY = "true"
			process.env.KILO_AWS_API_KEY = "test-api-key"
			const missing = getMissingEnvVars("bedrock")
			expect(missing).toEqual([])
		})

		it("should report auth missing when only one AWS key is set", () => {
			process.env.KILO_API_MODEL_ID = "test-model"
			process.env.KILO_AWS_REGION = "us-east-1"
			process.env.KILO_AWS_ACCESS_KEY = "test-access-key"
			const missing = getMissingEnvVars("bedrock")
			expect(missing).toContain(
				"KILO_AWS_ACCESS_KEY + KILO_AWS_SECRET_KEY (or KILO_AWS_PROFILE or KILO_AWS_API_KEY)",
			)
		})
	})

	describe("vertex provider", () => {
		it("should return all missing vars when none are set", () => {
			const missing = getMissingEnvVars("vertex")
			expect(missing).toEqual([
				"KILO_API_MODEL_ID",
				"KILO_VERTEX_PROJECT_ID",
				"KILO_VERTEX_REGION",
				"KILO_VERTEX_KEY_FILE or KILO_VERTEX_JSON_CREDENTIALS",
			])
		})

		it("should not report credentials missing when key file is set", () => {
			process.env.KILO_API_MODEL_ID = "test-model"
			process.env.KILO_VERTEX_PROJECT_ID = "test-project"
			process.env.KILO_VERTEX_REGION = "us-central1"
			process.env.KILO_VERTEX_KEY_FILE = "/path/to/key.json"
			const missing = getMissingEnvVars("vertex")
			expect(missing).toEqual([])
		})

		it("should not report credentials missing when JSON credentials are set", () => {
			process.env.KILO_API_MODEL_ID = "test-model"
			process.env.KILO_VERTEX_PROJECT_ID = "test-project"
			process.env.KILO_VERTEX_REGION = "us-central1"
			process.env.KILO_VERTEX_JSON_CREDENTIALS = '{"type":"service_account"}'
			const missing = getMissingEnvVars("vertex")
			expect(missing).toEqual([])
		})
	})

	describe("other providers", () => {
		it("should handle openai-native provider", () => {
			const missing = getMissingEnvVars("openai-native")
			expect(missing).toEqual(["KILO_OPENAI_NATIVE_API_KEY", "KILO_API_MODEL_ID"])

			process.env.KILO_OPENAI_NATIVE_API_KEY = "test-key"
			process.env.KILO_API_MODEL_ID = "test-model"
			expect(getMissingEnvVars("openai-native")).toEqual([])
		})

		it("should handle openai provider", () => {
			const missing = getMissingEnvVars("openai")
			expect(missing).toEqual(["KILO_OPENAI_API_KEY", "KILO_OPENAI_MODEL_ID"])

			process.env.KILO_OPENAI_API_KEY = "test-key"
			process.env.KILO_OPENAI_MODEL_ID = "test-model"
			expect(getMissingEnvVars("openai")).toEqual([])
		})

		it("should handle openrouter provider", () => {
			const missing = getMissingEnvVars("openrouter")
			expect(missing).toEqual(["KILO_OPENROUTER_API_KEY", "KILO_OPENROUTER_MODEL_ID"])

			process.env.KILO_OPENROUTER_API_KEY = "test-key"
			process.env.KILO_OPENROUTER_MODEL_ID = "test-model"
			expect(getMissingEnvVars("openrouter")).toEqual([])
		})

		it("should handle ollama provider", () => {
			const missing = getMissingEnvVars("ollama")
			expect(missing).toEqual(["KILO_OLLAMA_MODEL_ID"])

			process.env.KILO_OLLAMA_MODEL_ID = "test-model"
			expect(getMissingEnvVars("ollama")).toEqual([])
		})

		it("should handle gemini provider", () => {
			const missing = getMissingEnvVars("gemini")
			expect(missing).toEqual(["KILO_GEMINI_API_KEY", "KILO_API_MODEL_ID"])

			process.env.KILO_GEMINI_API_KEY = "test-key"
			process.env.KILO_API_MODEL_ID = "test-model"
			expect(getMissingEnvVars("gemini")).toEqual([])
		})

		it("should handle mistral provider", () => {
			const missing = getMissingEnvVars("mistral")
			expect(missing).toEqual(["KILO_MISTRAL_API_KEY", "KILO_API_MODEL_ID"])

			process.env.KILO_MISTRAL_API_KEY = "test-key"
			process.env.KILO_API_MODEL_ID = "test-model"
			expect(getMissingEnvVars("mistral")).toEqual([])
		})

		it("should handle groq provider", () => {
			const missing = getMissingEnvVars("groq")
			expect(missing).toEqual(["KILO_GROQ_API_KEY", "KILO_API_MODEL_ID"])

			process.env.KILO_GROQ_API_KEY = "test-key"
			process.env.KILO_API_MODEL_ID = "test-model"
			expect(getMissingEnvVars("groq")).toEqual([])
		})

		it("should handle deepseek provider", () => {
			const missing = getMissingEnvVars("deepseek")
			expect(missing).toEqual(["KILO_DEEPSEEK_API_KEY", "KILO_API_MODEL_ID"])

			process.env.KILO_DEEPSEEK_API_KEY = "test-key"
			process.env.KILO_API_MODEL_ID = "test-model"
			expect(getMissingEnvVars("deepseek")).toEqual([])
		})

		it("should handle xai provider", () => {
			const missing = getMissingEnvVars("xai")
			expect(missing).toEqual(["KILO_XAI_API_KEY", "KILO_API_MODEL_ID"])

			process.env.KILO_XAI_API_KEY = "test-key"
			process.env.KILO_API_MODEL_ID = "test-model"
			expect(getMissingEnvVars("xai")).toEqual([])
		})

		it("should handle unknown provider", () => {
			const missing = getMissingEnvVars("unknown")
			expect(missing).toEqual(["KILO_API_KEY"])

			process.env.KILO_API_KEY = "test-key"
			expect(getMissingEnvVars("unknown")).toEqual([])
		})
	})
})
