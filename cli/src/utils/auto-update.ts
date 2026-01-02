// kilocode_change start
import fs from "fs"
import path from "path"
// kilocode_change end
import packageJson from "package-json"
import { Package } from "../constants/package.js"
import { CliMessage } from "../types/cli.js"
import semver from "semver"
import { generateMessage } from "../ui/utils/messages.js"
// kilocode_change start
import { KiloCodePaths } from "./paths.js"
// kilocode_change end

type AutoUpdateStatus = {
	name: string
	isOutdated: boolean
	currentVersion: string
	latestVersion: string
}

// kilocode_change start
type VersionCheckCache = {
	lastChecked: number
	latestVersion: string
	isOutdated: boolean
}

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Get the path to the version check cache file
 */
const getCacheFilePath = (): string => {
	const globalStorageDir = KiloCodePaths.getGlobalStorageDir()
	KiloCodePaths.ensureDirectoryExists(globalStorageDir)
	return path.join(globalStorageDir, "version-check-cache.json")
}

/**
 * Read the version check cache from disk
 */
const readCache = (): VersionCheckCache | null => {
	try {
		const cacheFilePath = getCacheFilePath()
		if (!fs.existsSync(cacheFilePath)) {
			return null
		}

		const cacheContent = fs.readFileSync(cacheFilePath, "utf-8")
		const cache = JSON.parse(cacheContent) as VersionCheckCache

		// Validate cache structure
		if (
			typeof cache.lastChecked !== "number" ||
			typeof cache.latestVersion !== "string" ||
			typeof cache.isOutdated !== "boolean"
		) {
			return null
		}

		return cache
	} catch {
		return null
	}
}

/**
 * Write the version check cache to disk
 */
const writeCache = (cache: VersionCheckCache): void => {
	try {
		const cacheFilePath = getCacheFilePath()
		fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2), "utf-8")
	} catch {
		// Silent fail - caching is optional
	}
}

/**
 * Check if the cache is still valid (less than 24 hours old)
 */
const isCacheValid = (cache: VersionCheckCache | null): boolean => {
	if (!cache) {
		return false
	}

	const now = Date.now()
	const age = now - cache.lastChecked

	return age < CACHE_DURATION_MS
}
// kilocode_change end

export const getAutoUpdateStatus = async () => {
	const output = {
		name: Package.name,
		isOutdated: false,
		currentVersion: Package.version,
		latestVersion: Package.version,
	}

	// kilocode_change start
	// Check cache first
	const cache = readCache()
	if (isCacheValid(cache)) {
		return {
			...output,
			isOutdated: cache.isOutdated,
			latestVersion: cache.latestVersion,
		}
	}
	// kilocode_change end

	try {
		const latestPackage = await packageJson(Package.name)
		// kilocode_change start
		const isOutdated = semver.lt(Package.version, latestPackage.version)

		// Update cache
		writeCache({
			lastChecked: Date.now(),
			latestVersion: latestPackage.version,
			isOutdated,
		})

		return {
			...output,
			isOutdated,
			latestVersion: latestPackage.version,
		}
		// kilocode_change end
	} catch {
		// kilocode_change start
		// On error, return cached data if available, otherwise return default
		if (cache) {
			return {
				...output,
				isOutdated: cache.isOutdated,
				latestVersion: cache.latestVersion,
			}
		}
		// kilocode_change end
		return output
	}
}

export const generateUpdateAvailableMessage = (status: AutoUpdateStatus): CliMessage => {
	return {
		...generateMessage(),
		type: "system",
		content: `## A new version of Kilo CLI is available!
You are using v${status.currentVersion}, the latest version is v${status.latestVersion}.
Please run the following command to update:
\`\`\`bash
npm install -g ${status.name}
\`\`\``,
	}
}
