// kilocode_change - new file: Simple hook for release notes with global cache (UI-only, no persistence)
import { useState } from "react"
import { ReleaseNote } from "../types/release-notes"

// Global cache
let releasesCache: ReleaseData | null = null

const NULL_VERSION = "0.0.0"

interface ReleaseData {
	currentVersion: string
	releases: ReleaseNote[]
}

export const useReleaseNotes = () => {
	const [loading, setLoading] = useState(false)

	const loadReleases = async (): Promise<ReleaseData> => {
		if (releasesCache) {
			return releasesCache
		}

		setLoading(true)
		try {
			const data = await import("../generated/releases/releases.json")
			releasesCache = data.default as ReleaseData
			return releasesCache
		} catch (error) {
			console.error("Failed to load release notes:", error)
			releasesCache = { currentVersion: NULL_VERSION, releases: [] }
			return releasesCache
		} finally {
			setLoading(false)
		}
	}

	const hasUnviewedReleases = async (): Promise<boolean> => {
		// UI-only version: always return true to show releases
		return true
	}

	const markAsViewed = async (version: string): Promise<void> => {
		// UI-only version: no-op, no persistence
		console.log(`Would mark version ${version} as viewed (UI-only mode)`)
	}

	return {
		releases: releasesCache?.releases || [],
		currentVersion: releasesCache?.currentVersion || NULL_VERSION,
		loading,
		loadReleases,
		hasUnviewedReleases,
		markAsViewed,
	}
}
