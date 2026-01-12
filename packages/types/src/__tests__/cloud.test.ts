// npx vitest run src/__tests__/cloud.test.ts

import {
	organizationCloudSettingsSchema,
	organizationFeaturesSchema,
	organizationSettingsSchema,
	type OrganizationCloudSettings,
	type OrganizationFeatures,
	type OrganizationSettings,
	type WorkspaceTaskVisibility,
} from "../cloud.js"

describe("organizationFeaturesSchema", () => {
	it("should validate empty object", () => {
		const result = organizationFeaturesSchema.safeParse({})
		expect(result.success).toBe(true)
		expect(result.data).toEqual({})
	})

	it("should validate with roomoteControlEnabled as true", () => {
		const input = { roomoteControlEnabled: true }
		const result = organizationFeaturesSchema.safeParse(input)
		expect(result.success).toBe(true)
		expect(result.data).toEqual(input)
	})

	it("should validate with roomoteControlEnabled as false", () => {
		const input = { roomoteControlEnabled: false }
		const result = organizationFeaturesSchema.safeParse(input)
		expect(result.success).toBe(true)
		expect(result.data).toEqual(input)
	})

	it("should reject non-boolean roomoteControlEnabled", () => {
		const input = { roomoteControlEnabled: "true" }
		const result = organizationFeaturesSchema.safeParse(input)
		expect(result.success).toBe(false)
	})

	it("should allow additional properties (for future extensibility)", () => {
		const input = { roomoteControlEnabled: true, futureProperty: "test" }
		const result = organizationFeaturesSchema.safeParse(input)
		expect(result.success).toBe(true)
		expect(result.data?.roomoteControlEnabled).toBe(true)
		// Note: Additional properties are stripped by Zod, which is expected behavior
	})

	it("should have correct TypeScript type", () => {
		// Type-only test to ensure TypeScript compilation
		const features: OrganizationFeatures = {
			roomoteControlEnabled: true,
		}
		expect(features.roomoteControlEnabled).toBe(true)

		const emptyFeatures: OrganizationFeatures = {}
		expect(emptyFeatures.roomoteControlEnabled).toBeUndefined()
	})
})

describe("organizationSettingsSchema with features", () => {
	const validBaseSettings = {
		version: 1,
		defaultSettings: {},
		allowList: {
			allowAll: true,
			providers: {},
		},
	}

	it("should validate without features property", () => {
		const result = organizationSettingsSchema.safeParse(validBaseSettings)
		expect(result.success).toBe(true)
		expect(result.data?.features).toBeUndefined()
	})

	it("should validate with empty features object", () => {
		const input = {
			...validBaseSettings,
			features: {},
		}
		const result = organizationSettingsSchema.safeParse(input)
		expect(result.success).toBe(true)
		expect(result.data?.features).toEqual({})
	})

	it("should validate with features.roomoteControlEnabled as true", () => {
		const input = {
			...validBaseSettings,
			features: {
				roomoteControlEnabled: true,
			},
		}
		const result = organizationSettingsSchema.safeParse(input)
		expect(result.success).toBe(true)
		expect(result.data?.features?.roomoteControlEnabled).toBe(true)
	})

	it("should validate with features.roomoteControlEnabled as false", () => {
		const input = {
			...validBaseSettings,
			features: {
				roomoteControlEnabled: false,
			},
		}
		const result = organizationSettingsSchema.safeParse(input)
		expect(result.success).toBe(true)
		expect(result.data?.features?.roomoteControlEnabled).toBe(false)
	})

	it("should reject invalid features object", () => {
		const input = {
			...validBaseSettings,
			features: {
				roomoteControlEnabled: "invalid",
			},
		}
		const result = organizationSettingsSchema.safeParse(input)
		expect(result.success).toBe(false)
	})

	it("should have correct TypeScript type for features", () => {
		// Type-only test to ensure TypeScript compilation
		const settings: OrganizationSettings = {
			version: 1,
			defaultSettings: {},
			allowList: {
				allowAll: true,
				providers: {},
			},
			features: {
				roomoteControlEnabled: true,
			},
		}
		expect(settings.features?.roomoteControlEnabled).toBe(true)

		const settingsWithoutFeatures: OrganizationSettings = {
			version: 1,
			defaultSettings: {},
			allowList: {
				allowAll: true,
				providers: {},
			},
		}
		expect(settingsWithoutFeatures.features).toBeUndefined()
	})

	it("should maintain all existing properties", () => {
		const input = {
			version: 1,
			cloudSettings: {
				recordTaskMessages: true,
				enableTaskSharing: false,
			},
			defaultSettings: {},
			allowList: {
				allowAll: false,
				providers: {
					openai: {
						allowAll: true,
						models: ["gpt-4"],
					},
				},
			},
			features: {
				roomoteControlEnabled: true,
			},
			hiddenMcps: ["test-mcp"],
			hideMarketplaceMcps: true,
			mcps: [],
			providerProfiles: {},
		}
		const result = organizationSettingsSchema.safeParse(input)
		expect(result.success).toBe(true)
		expect(result.data).toEqual(input)
	})
})

describe("organizationCloudSettingsSchema with workspaceTaskVisibility", () => {
	it("should validate without workspaceTaskVisibility property", () => {
		const input = {
			recordTaskMessages: true,
			enableTaskSharing: true,
		}
		const result = organizationCloudSettingsSchema.safeParse(input)
		expect(result.success).toBe(true)
		expect(result.data?.workspaceTaskVisibility).toBeUndefined()
	})

	it("should validate with workspaceTaskVisibility as 'all'", () => {
		const input = {
			recordTaskMessages: true,
			workspaceTaskVisibility: "all" as WorkspaceTaskVisibility,
		}
		const result = organizationCloudSettingsSchema.safeParse(input)
		expect(result.success).toBe(true)
		expect(result.data?.workspaceTaskVisibility).toBe("all")
	})

	it("should validate with workspaceTaskVisibility as 'list-only'", () => {
		const input = {
			workspaceTaskVisibility: "list-only" as WorkspaceTaskVisibility,
		}
		const result = organizationCloudSettingsSchema.safeParse(input)
		expect(result.success).toBe(true)
		expect(result.data?.workspaceTaskVisibility).toBe("list-only")
	})

	it("should validate with workspaceTaskVisibility as 'full-lockdown'", () => {
		const input = {
			workspaceTaskVisibility: "full-lockdown" as WorkspaceTaskVisibility,
		}
		const result = organizationCloudSettingsSchema.safeParse(input)
		expect(result.success).toBe(true)
		expect(result.data?.workspaceTaskVisibility).toBe("full-lockdown")
	})

	it("should reject invalid workspaceTaskVisibility value", () => {
		const input = {
			workspaceTaskVisibility: "invalid-value",
		}
		const result = organizationCloudSettingsSchema.safeParse(input)
		expect(result.success).toBe(false)
	})

	it("should have correct TypeScript type", () => {
		// Type-only test to ensure TypeScript compilation
		const settings: OrganizationCloudSettings = {
			recordTaskMessages: true,
			workspaceTaskVisibility: "all",
		}
		expect(settings.workspaceTaskVisibility).toBe("all")

		const settingsWithoutVisibility: OrganizationCloudSettings = {
			recordTaskMessages: false,
		}
		expect(settingsWithoutVisibility.workspaceTaskVisibility).toBeUndefined()
	})

	it("should validate in organizationSettingsSchema with workspaceTaskVisibility", () => {
		const input = {
			version: 1,
			cloudSettings: {
				recordTaskMessages: true,
				enableTaskSharing: true,
				workspaceTaskVisibility: "list-only" as WorkspaceTaskVisibility,
			},
			defaultSettings: {},
			allowList: {
				allowAll: true,
				providers: {},
			},
		}
		const result = organizationSettingsSchema.safeParse(input)
		expect(result.success).toBe(true)
		expect(result.data?.cloudSettings?.workspaceTaskVisibility).toBe("list-only")
	})
})
