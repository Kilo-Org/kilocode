// kilocode_change - new file: Simple hook for release notes with global cache
import { useState } from "react"
import { useExtensionState } from "../context/ExtensionStateContext"
import { vscode } from "../utils/vscode"
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
	const { lastViewedReleaseVersion } = useExtensionState()

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
		const releases = await loadReleases()
		const lastViewed = lastViewedReleaseVersion || NULL_VERSION
		return lastViewed === NULL_VERSION || releases.currentVersion !== lastViewed
	}

	const markAsViewed = async (version: string): Promise<void> => {
		try {
			vscode.postMessage({
				type: "updateGlobalState",
				key: "lastViewedReleaseVersion",
				stateValue: version,
			})
		} catch (error) {
			console.error("Failed to mark version as viewed:", error)
			throw error
		}
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
