package ai.kilocode.backend.rpc

import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.WorktreePrDto
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Path

/** Result of running a `git`/`gh` command. */
internal data class CmdOut(val exit: Int, val stdout: String, val stderr: String) {
    val ok get() = exit == 0
}

/** PR for one checkout, plus the gh availability observed while resolving it. */
internal data class PrLookup(val pr: WorktreePrDto? = null, val availability: GhAvailability = GhAvailability.OK)

/** Scalar fields every supported `gh` release and token can answer. */
internal const val PR_FIELDS = "number,state,isDraft,url,title"

/**
 * [PR_FIELDS] plus the review verdict and CI rollup. Both are GraphQL sub-queries rather than scalars,
 * so an older `gh` rejects the field names outright and a restricted token is refused the data. See
 * [richUnsupported] for how that is detected and [PrResolver] for the fallback.
 */
internal const val PR_RICH_FIELDS = "$PR_FIELDS,reviewDecision,statusCheckRollup"

/**
 * Whether a failing `gh pr` command was rejected for asking about review or CI state, rather than for
 * any of the ordinary reasons (no PR, no auth, no network).
 *
 * This has to be distinguished because [prError] treats everything non-auth as "no PR here", so an
 * unsupported field would otherwise make a checkout with a perfectly good PR report no PR at all.
 */
internal fun richUnsupported(stderr: String): Boolean {
    val text = stderr.lowercase()
    // Old gh rejects the field name; a restricted token is refused the underlying GraphQL node.
    if (text.contains("unknown json field")) return true
    return text.contains("resource not accessible by integration")
}

/**
 * Resolves the pull request a checkout belongs to. A worktree can reach a PR in several ways —
 * Kilo's PR import, `gh pr checkout`, a hand-made `git worktree add`, a branch renamed locally, a
 * fork PR — so identity is resolved by branch config or head commit rather than by branch name
 * alone, in increasing order of cost:
 *
 * 1. `gh pr view` with no selector. The only form that honours `branch.<name>.merge`, so it
 *    resolves `refs/pull/N/head` branches by PR number and fork PRs through the push remote.
 * 2. `gh pr view <branch>`. Matches same-repo branches pushed to origin, no branch config needed.
 *    Cannot match a fork PR: gh compares against `owner:branch` for cross-repository heads.
 * 3. `gh pr list --search "<HEAD sha>"`, accepting only an exact `headRefOid` match.
 *
 * Commands are injected so the strategy ladder is testable without `gh` or network access.
 */
internal class PrResolver(
    private val gh: (Path, List<String>) -> CmdOut,
    private val git: (Path, List<String>) -> CmdOut,
) {
    // Volatile because prStatus resolves several checkouts concurrently. Two threads racing to clear it
    // is harmless: both observed the same unsupported field and both write false.
    @Volatile
    private var rich = true

    /**
     * Resolves the PR for the checkout at [path] on [branch]. [base] is the repository's base
     * branch; a PR headed by it is not worth a search query, so strategy 3 is skipped there.
     */
    fun resolve(path: String, branch: String, base: String?): PrLookup {
        val dir = Path.of(path).normalize()
        view(dir, path, null)?.let { return it }
        view(dir, path, branch)?.let { return it }
        if (branch == base) return PrLookup()
        return search(dir, path) ?: PrLookup()
    }

    /** Null means "no PR here, keep looking"; a value is terminal (a PR, or gh being unusable). */
    private fun view(dir: Path, path: String, branch: String?): PrLookup? {
        val out = query(dir) { fields ->
            buildList {
                add("pr")
                add("view")
                branch?.let { add(it) }
                add("--json")
                add(fields)
            }
        }
        if (!out.ok) return unusable(out.stderr)
        return parsePr(path, out.stdout)?.let { PrLookup(it) }
    }

    /**
     * Runs a `gh pr` command with the richest field list this `gh` and token have proven they can
     * answer, dropping to [PR_FIELDS] and retrying once when they turn out they cannot.
     *
     * The downgrade latches, so a release or token without review/CI support costs one extra call in
     * total rather than one per checkout on every poll.
     */
    private fun query(dir: Path, command: (String) -> List<String>): CmdOut {
        val wanted = if (rich) PR_RICH_FIELDS else PR_FIELDS
        val out = gh(dir, command(wanted))
        if (out.ok || wanted == PR_FIELDS || !richUnsupported(out.stderr)) return out
        rich = false
        LOG.info("gh cannot answer review/CI fields, falling back to scalars: ${out.stderr.trim()}")
        return gh(dir, command(PR_FIELDS))
    }

    private fun search(dir: Path, path: String): PrLookup? {
        val head = git(dir, listOf("rev-parse", "HEAD")).stdout.trim()
        if (head.isEmpty()) return null
        val out = query(dir) { fields ->
            listOf("pr", "list", "--state", "all", "--search", "$head is:pr", "--limit", "5", "--json", "$fields,headRefOid")
        }
        if (!out.ok) return unusable(out.stderr)
        val items = runCatching { json.parseToJsonElement(out.stdout) as? JsonArray }.getOrNull() ?: return null
        for (item in items) {
            val obj = item as? JsonObject ?: continue
            // The search matches commit mentions too, so only an exact head match is our PR.
            if (obj["headRefOid"]?.jsonPrimitive?.content != head) continue
            parsePr(path, obj.toString())?.let { return PrLookup(it) }
        }
        return null
    }

    private fun unusable(stderr: String): PrLookup? {
        val status = prError(stderr)
        return if (status == GhAvailability.OK) null else PrLookup(availability = status)
    }
}

/**
 * Classifies a failing `gh pr` command. A missing PR is the normal case, so anything that is not a
 * recognised authorization failure counts as OK — a missing `gh` binary is caught by the upfront
 * availability probe instead.
 */
internal fun prError(stderr: String): GhAvailability {
    val text = stderr.lowercase()
    if (text.contains("not logged") || text.contains("gh auth login") || text.contains("authentication")) {
        return GhAvailability.UNAUTH
    }
    return GhAvailability.OK
}

private val json = Json { ignoreUnknownKeys = true }

private val LOG = KiloLog.create(PrResolver::class.java)
