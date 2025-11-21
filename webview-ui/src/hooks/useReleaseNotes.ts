// kilocode_change - simplified: Load and parse changelog markdown directly
import { useState } from "react"
import { loadChangelog } from "../utils/changelogLoader"

// Global cache
let changelogCache: string | null = null
let currentVersionCache: string | null = null

const NULL_VERSION = "0.0.0"

// Parse version from markdown by finding first version header
function parseVersionFromMarkdown(markdown: string): string {
	const versionHeaderRegex = /^## \[v(\d+\.\d+\.\d+)\]/m
	const match = markdown.match(versionHeaderRegex)
	return match ? match[1] : NULL_VERSION
}

export const useReleaseNotes = () => {
	const [loading, setLoading] = useState(false)

	const loadReleases = async () => {
		if (changelogCache && currentVersionCache) {
			return { markdown: changelogCache, currentVersion: currentVersionCache }
		}

		setLoading(true)
		try {
			changelogCache = await loadChangelog()
			currentVersionCache = parseVersionFromMarkdown(changelogCache)

			return { markdown: changelogCache, currentVersion: currentVersionCache }
		} catch (error) {
			console.error("Failed to load release notes:", error)
			changelogCache = ""
			currentVersionCache = NULL_VERSION
			return { markdown: "", currentVersion: NULL_VERSION }
		} finally {
			setLoading(false)
		}
	}

	return {
		markdown: changelogCache || "",
		currentVersion: currentVersionCache || NULL_VERSION,
		loading,
		loadReleases,
	}
}
