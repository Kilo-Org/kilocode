import {
	compareSemver,
	meetsMinimumVersion,
	findHighestMatchingVersion,
	resolveVersionedSettings,
	type VersionedSettings,
} from "../versionedSettings"
import { Package } from "../../../../shared/package"

describe("versionedSettings", () => {
	describe("compareSemver", () => {
		it("should return 0 for equal versions", () => {
			expect(compareSemver("1.0.0", "1.0.0")).toBe(0)
			expect(compareSemver("3.36.4", "3.36.4")).toBe(0)
			expect(compareSemver("0.0.1", "0.0.1")).toBe(0)
		})

		it("should return positive when first version is greater", () => {
			expect(compareSemver("2.0.0", "1.0.0")).toBeGreaterThan(0)
			expect(compareSemver("1.1.0", "1.0.0")).toBeGreaterThan(0)
			expect(compareSemver("1.0.1", "1.0.0")).toBeGreaterThan(0)
			expect(compareSemver("3.36.5", "3.36.4")).toBeGreaterThan(0)
			expect(compareSemver("3.37.0", "3.36.4")).toBeGreaterThan(0)
			expect(compareSemver("4.0.0", "3.36.4")).toBeGreaterThan(0)
		})

		it("should return negative when first version is smaller", () => {
			expect(compareSemver("1.0.0", "2.0.0")).toBeLessThan(0)
			expect(compareSemver("1.0.0", "1.1.0")).toBeLessThan(0)
			expect(compareSemver("1.0.0", "1.0.1")).toBeLessThan(0)
			expect(compareSemver("3.36.3", "3.36.4")).toBeLessThan(0)
			expect(compareSemver("3.35.0", "3.36.4")).toBeLessThan(0)
			expect(compareSemver("2.0.0", "3.36.4")).toBeLessThan(0)
		})

		it("should handle pre-release versions by ignoring pre-release suffix", () => {
			expect(compareSemver("3.36.4-beta.1", "3.36.4")).toBe(0)
			expect(compareSemver("3.36.4-rc.2", "3.36.4")).toBe(0)
			expect(compareSemver("3.36.5-alpha", "3.36.4")).toBeGreaterThan(0)
			expect(compareSemver("3.36.3-beta", "3.36.4")).toBeLessThan(0)
		})

		it("should handle edge cases", () => {
			expect(compareSemver("0.0.0", "0.0.0")).toBe(0)
			expect(compareSemver("10.20.30", "10.20.30")).toBe(0)
			expect(compareSemver("10.0.0", "9.99.99")).toBeGreaterThan(0)
		})
	})

	describe("meetsMinimumVersion", () => {
		it("should return true when current version equals minimum", () => {
			expect(meetsMinimumVersion("3.36.4", "3.36.4")).toBe(true)
		})

		it("should return true when current version exceeds minimum", () => {
			expect(meetsMinimumVersion("3.36.4", "3.36.5")).toBe(true)
			expect(meetsMinimumVersion("3.36.4", "3.37.0")).toBe(true)
			expect(meetsMinimumVersion("3.36.4", "4.0.0")).toBe(true)
		})

		it("should return false when current version is below minimum", () => {
			expect(meetsMinimumVersion("3.36.4", "3.36.3")).toBe(false)
			expect(meetsMinimumVersion("3.36.4", "3.35.0")).toBe(false)
			expect(meetsMinimumVersion("3.36.4", "2.0.0")).toBe(false)
		})
	})

	describe("findHighestMatchingVersion", () => {
		it("should return undefined when no versions match", () => {
			const versionedSettings: VersionedSettings = {
				"4.0.0": { includedTools: ["apply_diff"] },
				"5.0.0": { includedTools: ["apply_diff", "search_replace"] },
			}

			const result = findHighestMatchingVersion(versionedSettings, "3.36.4")
			expect(result).toBeUndefined()
		})

		it("should return the exact version when it matches", () => {
			const versionedSettings: VersionedSettings = {
				"3.36.4": { includedTools: ["apply_diff"] },
				"3.35.0": { includedTools: ["search_replace"] },
			}

			const result = findHighestMatchingVersion(versionedSettings, "3.36.4")
			expect(result).toBe("3.36.4")
		})

		it("should return the highest version that is <= current version", () => {
			const versionedSettings: VersionedSettings = {
				"3.37.0": { includedTools: ["future_tool"] },
				"3.36.4": { includedTools: ["apply_diff"] },
				"3.35.0": { includedTools: ["search_replace"] },
				"3.34.0": { includedTools: ["basic_tool"] },
			}

			// Current version is 3.36.5, should match 3.36.4 (highest <= 3.36.5)
			const result = findHighestMatchingVersion(versionedSettings, "3.36.5")
			expect(result).toBe("3.36.4")
		})

		it("should handle single version", () => {
			const versionedSettings: VersionedSettings = {
				"3.35.0": { includedTools: ["search_replace"] },
			}

			expect(findHighestMatchingVersion(versionedSettings, "3.36.4")).toBe("3.35.0")
			expect(findHighestMatchingVersion(versionedSettings, "3.34.0")).toBeUndefined()
		})

		it("should handle empty versionedSettings", () => {
			const versionedSettings: VersionedSettings = {}

			const result = findHighestMatchingVersion(versionedSettings, "3.36.4")
			expect(result).toBeUndefined()
		})

		it("should treat nightly builds (by package name) as always eligible and pick highest version", () => {
			const versionedSettings: VersionedSettings = {
				"3.36.3": { feature: "v3" },
				"2.0.0": { feature: "v2" },
			}

			const originalName = Package.name
			;(Package as { name: string }).name = "roo-code-nightly"

			try {
				const result = findHighestMatchingVersion(versionedSettings, "1.0.0")
				expect(result).toBe("3.36.3")
			} finally {
				;(Package as { name: string }).name = originalName
			}
		})
	})

	describe("resolveVersionedSettings", () => {
		const currentVersion = "3.36.4"

		it("should return settings for exact version match", () => {
			const versionedSettings: VersionedSettings = {
				"3.36.4": {
					includedTools: ["search_replace"],
					excludedTools: ["apply_diff"],
				},
			}

			const resolved = resolveVersionedSettings(versionedSettings, currentVersion)

			expect(resolved).toEqual({
				includedTools: ["search_replace"],
				excludedTools: ["apply_diff"],
			})
		})

		it("should return settings for highest matching version", () => {
			const versionedSettings: VersionedSettings = {
				"4.0.0": {
					includedTools: ["future_tool"],
				},
				"3.36.0": {
					includedTools: ["search_replace"],
					excludedTools: ["apply_diff"],
				},
				"3.35.0": {
					includedTools: ["old_tool"],
				},
			}

			const resolved = resolveVersionedSettings(versionedSettings, currentVersion)

			expect(resolved).toEqual({
				includedTools: ["search_replace"],
				excludedTools: ["apply_diff"],
			})
		})

		it("should return empty object when no versions match", () => {
			const versionedSettings: VersionedSettings = {
				"4.0.0": {
					includedTools: ["future_tool"],
				},
				"3.37.0": {
					includedTools: ["newer_tool"],
				},
			}

			const resolved = resolveVersionedSettings(versionedSettings, currentVersion)

			expect(resolved).toEqual({})
		})

		it("should handle empty versionedSettings", () => {
			const resolved = resolveVersionedSettings({}, currentVersion)
			expect(resolved).toEqual({})
		})

		it("should handle versioned boolean values", () => {
			const versionedSettings: VersionedSettings = {
				"3.36.0": {
					supportsNativeTools: true,
				},
			}

			const resolved = resolveVersionedSettings(versionedSettings, currentVersion)

			expect(resolved).toEqual({
				supportsNativeTools: true,
			})
		})

		it("should handle versioned null values", () => {
			const versionedSettings: VersionedSettings = {
				"3.36.0": {
					defaultTemperature: null,
				},
			}

			const resolved = resolveVersionedSettings(versionedSettings, currentVersion)

			expect(resolved).toEqual({
				defaultTemperature: null,
			})
		})

		it("should handle versioned nested objects", () => {
			const versionedSettings: VersionedSettings = {
				"3.36.0": {
					complexSetting: { nested: { deeply: true } },
				},
			}

			const resolved = resolveVersionedSettings(versionedSettings, currentVersion)

			expect(resolved).toEqual({
				complexSetting: { nested: { deeply: true } },
			})
		})

		it("should use all settings from the matching version", () => {
			const versionedSettings: VersionedSettings = {
				"3.36.4": {
					includedTools: ["search_replace", "apply_diff"],
					excludedTools: ["write_to_file"],
					supportsReasoningEffort: true,
					description: "Updated model",
				},
				"3.35.0": {
					includedTools: ["search_replace"],
					description: "Old model",
				},
			}

			const resolved = resolveVersionedSettings(versionedSettings, "3.36.4")

			expect(resolved).toEqual({
				includedTools: ["search_replace", "apply_diff"],
				excludedTools: ["write_to_file"],
				supportsReasoningEffort: true,
				description: "Updated model",
			})
		})

		it("should handle multiple versions and select correct one", () => {
			const versionedSettings: VersionedSettings = {
				"3.38.0": { feature: "very_new" },
				"3.37.0": { feature: "new" },
				"3.36.0": { feature: "current" },
				"3.35.0": { feature: "old" },
				"3.34.0": { feature: "very_old" },
			}

			// Test different current versions
			expect(resolveVersionedSettings(versionedSettings, "3.40.0")).toEqual({ feature: "very_new" })
			expect(resolveVersionedSettings(versionedSettings, "3.37.5")).toEqual({ feature: "new" })
			expect(resolveVersionedSettings(versionedSettings, "3.36.5")).toEqual({ feature: "current" })
			expect(resolveVersionedSettings(versionedSettings, "3.35.5")).toEqual({ feature: "old" })
			expect(resolveVersionedSettings(versionedSettings, "3.34.5")).toEqual({ feature: "very_old" })
			expect(resolveVersionedSettings(versionedSettings, "3.33.0")).toEqual({})
		})
	})
})
