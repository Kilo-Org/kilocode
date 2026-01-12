import cmp from "semver-compare"

import { Package } from "../../../shared/package"

function isNightlyBuild(): boolean {
	return Package.name.toLowerCase().includes("nightly")
}

/**
 * Type for versioned settings where the version is the key.
 * Each version key maps to a settings object that should be used
 * when the current plugin version is >= that version.
 *
 * Example API response:
 * ```
 * {
 *   settings: {
 *     includedTools: ['search_replace']  // Plain value for old clients
 *   },
 *   versionedSettings: {
 *     '3.36.4': {
 *       includedTools: ['search_replace', 'apply_diff'],  // Enhanced value for 3.36.4+
 *       excludedTools: ['write_to_file'],
 *     },
 *     '3.35.0': {
 *       includedTools: ['search_replace'],  // Value for 3.35.0 - 3.36.3
 *     },
 *   }
 * }
 * ```
 *
 * The resolver will find the highest version key that is <= the current plugin version
 * and use those settings. If no version matches, falls back to plain `settings`.
 */
export type VersionedSettings = Record<string, Record<string, unknown>>

/**
 * Compares two semantic version strings using semver-compare.
 *
 * @param version1 First version string (e.g., "3.36.4")
 * @param version2 Second version string (e.g., "3.36.0")
 * @returns -1 if version1 < version2, 0 if equal, 1 if version1 > version2
 */
export function compareSemver(version1: string, version2: string): number {
	// Handle pre-release versions by stripping the suffix
	// semver-compare doesn't handle pre-release properly
	const stripPrerelease = (v: string): string => v.split("-")[0]
	return cmp(stripPrerelease(version1), stripPrerelease(version2))
}

/**
 * Checks if the current plugin version meets or exceeds the required minimum version.
 *
 * @param minPluginVersion The minimum required version
 * @param currentVersion The current plugin version (defaults to Package.version)
 * @returns true if current version >= minPluginVersion
 */
export function meetsMinimumVersion(minPluginVersion: string, currentVersion: string = Package.version): boolean {
	return compareSemver(currentVersion, minPluginVersion) >= 0
}

/**
 * Finds the highest version from versionedSettings that is <= the current plugin version.
 *
 * @param versionedSettings The versioned settings object with version keys
 * @param currentVersion The current plugin version (defaults to Package.version)
 * @returns The highest matching version key, or undefined if none match
 */
export function findHighestMatchingVersion(
	versionedSettings: VersionedSettings,
	currentVersion: string = Package.version,
): string | undefined {
	const versions = Object.keys(versionedSettings)

	if (versions.length === 0) {
		return undefined
	}

	// Nightly builds should always pick the highest available versioned settings
	if (isNightlyBuild()) {
		versions.sort((a, b) => compareSemver(b, a))
		return versions[0]
	}

	// Filter to versions that are <= currentVersion
	const matchingVersions = versions.filter((version) => meetsMinimumVersion(version, currentVersion))

	if (matchingVersions.length === 0) {
		return undefined
	}

	// Sort in descending order and return the highest
	matchingVersions.sort((a, b) => compareSemver(b, a))
	return matchingVersions[0]
}

/**
 * Resolves versioned settings by finding the highest version that is <= the current
 * plugin version and returning those settings.
 *
 * The versionedSettings structure uses version numbers as keys:
 * ```
 * versionedSettings: {
 *   '3.36.4': { includedTools: ['search_replace'], excludedTools: ['apply_diff'] },
 *   '3.35.0': { includedTools: ['search_replace'] },
 * }
 * ```
 *
 * This function finds the highest version key that is <= currentVersion and returns
 * the corresponding settings object. If no version matches, returns an empty object.
 *
 * @param versionedSettings The versioned settings object with version keys
 * @param currentVersion The current plugin version (defaults to Package.version)
 * @returns The settings object for the highest matching version, or empty object if none match
 */
export function resolveVersionedSettings<T extends Record<string, unknown>>(
	versionedSettings: VersionedSettings,
	currentVersion: string = Package.version,
): Partial<T> {
	const matchingVersion = findHighestMatchingVersion(versionedSettings, currentVersion)

	if (!matchingVersion) {
		return {}
	}

	return versionedSettings[matchingVersion] as Partial<T>
}
