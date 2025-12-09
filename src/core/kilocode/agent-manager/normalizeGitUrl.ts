/**
 * Normalizes a git remote URL by removing authentication credentials.
 *
 * This ensures consistent comparison regardless of how the repository was cloned.
 * When users clone repos with personal access tokens (e.g., https://token@github.com/org/repo.git),
 * the URL stored in .git/config includes those credentials. This function strips them
 * to enable proper matching between client and server URLs.
 *
 * @param url The git remote URL to normalize
 * @returns The URL with credentials removed, or the original URL if parsing fails
 *
 * @example
 * // HTTPS URLs with credentials
 * normalizeGitUrl("https://token@github.com/org/repo.git")
 * // => "https://github.com/org/repo.git"
 *
 * normalizeGitUrl("https://oauth2:ghp_xxx@github.com/org/repo.git")
 * // => "https://github.com/org/repo.git"
 *
 * // SSH URLs are unchanged (git@ is not a secret)
 * normalizeGitUrl("git@github.com:org/repo.git")
 * // => "git@github.com:org/repo.git"
 */
export function normalizeGitUrl(url: string): string {
	// Only normalize HTTP(S) URLs - SSH URLs don't contain secret tokens
	if (url.startsWith("https://") || url.startsWith("http://")) {
		try {
			// Use the built-in WHATWG URL API to parse and reconstruct the URL
			const parsed = new URL(url)
			parsed.username = ""
			parsed.password = ""
			return parsed.toString()
		} catch {
			return url
		}
	}

	// SSH URLs (git@host:path or ssh://git@host/path) - return unchanged
	return url
}
