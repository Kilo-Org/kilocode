import { describe, it, expect } from "vitest"
import { buildProviderEnvOverrides } from "../providerEnvMapper"
import type { ProviderSettings } from "@roo-code/types"

const log = (_msg: string) => {}
const debugLog = (_msg: string) => {}

describe("providerEnvMapper", () => {
	it("returns empty overrides when apiConfiguration is missing", () => {
		const overrides = buildProviderEnvOverrides(undefined, {}, log, debugLog)
		expect(overrides).toEqual({})
	})

	it("injects kilocode provider env without clobbering base env", () => {
		const baseEnv = { KEEP_ME: "1", KILOCODE_TOKEN: "user-token" }
		const overrides = buildProviderEnvOverrides(
			{
				apiProvider: "kilocode",
				kilocodeToken: "ext-token",
				kilocodeModel: "model-1",
			} as ProviderSettings,
			baseEnv,
			log,
			debugLog,
		)

		// Extension-provided fields win, unrelated env is preserved
		expect(overrides.KILO_PROVIDER_TYPE).toBe("kilocode")
		expect(overrides.KILOCODE_TOKEN).toBe("ext-token")
		expect(overrides.KILOCODE_MODEL).toBe("model-1")
		expect(overrides.KEEP_ME).toBeUndefined()
	})

	it("skips injection when bedrock requirements are incomplete", () => {
		const overrides = buildProviderEnvOverrides(
			{
				apiProvider: "bedrock",
				apiModelId: "m1",
				awsRegion: "us-east-1",
				// Missing key/profile/api key trio
			} as ProviderSettings,
			{},
			log,
			debugLog,
		)

		expect(overrides).toEqual({})
	})

	it("injects bedrock when profile auth is provided", () => {
		const overrides = buildProviderEnvOverrides(
			{
				apiProvider: "bedrock",
				apiModelId: "m1",
				awsRegion: "us-east-1",
				awsUseProfile: true,
				awsProfile: "default",
			} as ProviderSettings,
			{},
			log,
			debugLog,
		)

		expect(overrides.KILO_PROVIDER_TYPE).toBe("bedrock")
		expect(overrides.KILO_AWS_PROFILE).toBe("default")
		expect(overrides.KILO_API_MODEL_ID).toBe("m1")
		expect(overrides.KILO_AWS_REGION).toBe("us-east-1")
	})

	it("skips vertex when neither key file nor JSON creds are present", () => {
		const overrides = buildProviderEnvOverrides(
			{
				apiProvider: "vertex",
				apiModelId: "m1",
				vertexProjectId: "proj",
				vertexRegion: "us-central1",
			} as ProviderSettings,
			{},
			log,
			debugLog,
		)

		expect(overrides).toEqual({})
	})

	it("injects vertex when key file is provided", () => {
		const overrides = buildProviderEnvOverrides(
			{
				apiProvider: "vertex",
				apiModelId: "m1",
				vertexProjectId: "proj",
				vertexRegion: "us-central1",
				vertexKeyFile: "/tmp/key.json",
			} as ProviderSettings,
			{},
			log,
			debugLog,
		)

		expect(overrides.KILO_PROVIDER_TYPE).toBe("vertex")
		expect(overrides.KILO_API_MODEL_ID).toBe("m1")
		expect(overrides.KILO_VERTEX_KEY_FILE).toBe("/tmp/key.json")
		expect(overrides.KILO_VERTEX_PROJECT_ID).toBe("proj")
		expect(overrides.KILO_VERTEX_REGION).toBe("us-central1")
	})
})
