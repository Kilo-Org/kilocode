package ai.kilocode.rpc

data class PrRef(val owner: String, val repo: String, val number: Int)

// The host has to sit at the start of the string or on a scheme/userinfo boundary, with any subdomain
// labels in between, so `notgithub.com` is not read as GitHub while `www.github.com` is. Both halves
// matter: without the labels a `www.` origin parses as null, which `foreignPr` reads as "cannot tell"
// and the cross-repo guard silently stops running; without the boundary anchor a *path* segment
// ending in `.github.com` would match too. The optional port covers `ssh://…:22/` URLs.
private const val HOST = "(?:^|//|@)(?:[\\w-]+\\.)*github\\.com(?::\\d+)?[/:]"

private val PR_URL = Regex("$HOST([^/]+)/([^/]+?)(?:\\.git)?/pull/(\\d+)")
private val REPO_URL = Regex("$HOST([^/]+)/([^/]+?)(?:\\.git)?/*$")

/** Parses `https://github.com/<owner>/<repo>/pull/<n>` (and ssh-style hosts) into its parts. */
fun parsePrUrl(url: String): PrRef? {
    val match = PR_URL.find(url.trim()) ?: return null
    val number = match.groupValues[3].toIntOrNull() ?: return null
    return PrRef(match.groupValues[1], match.groupValues[2], number)
}

/** Parses a GitHub remote URL (ssh or https) into `owner/repo`; null for a non-GitHub remote. */
fun parseRepoSlug(url: String): String? {
    val match = REPO_URL.find(url.trim()) ?: return null
    return "${match.groupValues[1]}/${match.groupValues[2]}"
}

/**
 * True when [slug] names a repository other than [origin]. GitHub owner/repo names are
 * case-insensitive, and an unknown [origin] — no remote, or one this parser does not read as
 * GitHub — is not evidence of a mismatch, so neither is reported as foreign.
 */
fun foreignPr(slug: String, origin: String?): Boolean =
    origin != null && !slug.equals(origin, ignoreCase = true)
