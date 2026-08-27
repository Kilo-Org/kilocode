package ai.kilocode.rpc

data class PrRef(val owner: String, val repo: String, val number: Int)

private val PR_URL = Regex("github\\.com[/:]([^/]+)/([^/]+?)(?:\\.git)?/pull/(\\d+)")

/** Parses `https://github.com/<owner>/<repo>/pull/<n>` (and ssh-style hosts) into its parts. */
fun parsePrUrl(url: String): PrRef? {
    val match = PR_URL.find(url.trim()) ?: return null
    val number = match.groupValues[3].toIntOrNull() ?: return null
    return PrRef(match.groupValues[1], match.groupValues[2], number)
}
