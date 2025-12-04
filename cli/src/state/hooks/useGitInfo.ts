/**
 * Hook for fetching Git repository information
 */

import { useEffect, useState } from "react"
import { getGitInfo, type GitInfo } from "../../utils/git.js"

export interface UseGitInfoReturn extends GitInfo {
	loading: boolean
}

/**
 * Hook to get Git repository information for the current workspace
 * Fetches git info on mount and when cwd changes
 * Debounces updates to avoid excessive git calls
 *
 * @param cwd - Current working directory path
 * @returns Git information with loading state
 */
export function useGitInfo(cwd: string | null): UseGitInfoReturn {
	const [gitInfo, setGitInfo] = useState<GitInfo>({
		branch: null,
		isClean: true,
		isRepo: false,
	})
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		let isMounted = true
		let timeoutId: NodeJS.Timeout | null = null

		const fetchGitInfo = async () => {
			if (!cwd) {
				setGitInfo({
					branch: null,
					isClean: true,
					isRepo: false,
				})
				setLoading(false)
				return
			}

			try {
				setLoading(true)
				const info = await getGitInfo(cwd)
				if (isMounted) {
					setGitInfo(info)
					setLoading(false)
				}
			} catch {
				if (isMounted) {
					setGitInfo({
						branch: null,
						isClean: true,
						isRepo: false,
					})
					setLoading(false)
				}
			}
		}

		// Debounce git info fetching to avoid excessive calls
		timeoutId = setTimeout(() => {
			fetchGitInfo()
		}, 100)

		return () => {
			isMounted = false
			if (timeoutId) {
				clearTimeout(timeoutId)
			}
		}
	}, [cwd])

	return {
		...gitInfo,
		loading,
	}
}
