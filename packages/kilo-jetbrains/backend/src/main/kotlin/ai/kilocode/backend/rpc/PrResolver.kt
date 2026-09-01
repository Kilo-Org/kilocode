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
 * [richRefusal] for how that is detected and [PrResolver] for the fallback.
 */
internal const val PR_RICH_FIELDS = "$PR_FIELDS,reviewDecision,statusCheckRollup"

/** Why a `gh pr` command refused [PR_RICH_FIELDS], which decides whether the downgrade may latch. */
internal enum class RichRefusal {
    /** The `gh` release does not know the field names. True for every repository this process sees. */
    FIELD,

    /** The token is refused the GraphQL node. Usually specific to one repository or one installation. */
    ACCESS,
}

/**
 * Whether a failing `gh pr` command was rejected for asking about review or CI state, rather than for
 * any of the ordinary reasons (no PR, no auth, no network).
 *
 * This has to be distinguished because [prError] treats everything non-auth as "no PR here", so a
 * refused field would otherwise make a checkout with a perfectly good PR report no PR at all. The
 * wordings match the VS Code poller's: fine-grained PATs say "not accessible by personal access
 * token", GitHub Apps say "by integration", older GHE reports the GraphQL field as non-existent, and
 * org policies answer with a scope or forbidden error.
 */
internal fun richRefusal(stderr: String): RichRefusal? {
    val text = stderr.lowercase()
    if (text.contains("unknown json field")) return RichRefusal.FIELD
    if (text.contains("doesn't exist") || text.contains("does not exist")) return RichRefusal.FIELD
    if (text.contains("not accessible")) return RichRefusal.ACCESS
    if (text.contains("insufficient") || text.contains("forbidden")) return RichRefusal.ACCESS
    return null
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
     * A [RichRefusal.FIELD] downgrade latches, so a `gh` release without review/CI support costs one
     * extra call in total rather than one per checkout on every poll. A [RichRefusal.ACCESS] refusal
     * does not: one resolver serves the whole backend, and the token is usually only refused the node
     * for the repository that reported it, so latching would strip review/CI from every other
     * checkout until the IDE restarts.
     */
    private fun query(dir: Path, command: (String) -> List<String>): CmdOut {
        val wanted = if (rich) PR_RICH_FIELDS else PR_FIELDS
        val out = gh(dir, command(wanted))
        if (out.ok || wanted == PR_FIELDS) return out
        // A spent budget refuses the scalar form just as readily, so retrying only burns another call.
        if (rateLimited(out.stderr.lowercase())) return out
        val refusal = richRefusal(out.stderr) ?: return out
        if (refusal == RichRefusal.FIELD) {
            rich = false
            LOG.info("gh cannot answer review/CI fields, falling back to scalars: ${out.stderr.trim()}")
        }
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
 * recognised authorization or budget failure counts as OK — a missing `gh` binary is caught by the
 * upfront availability probe instead.
 */
internal fun prError(stderr: String): GhAvailability {
    val text = stderr.lowercase()
    if (text.contains("not logged") || text.contains("gh auth login") || text.contains("authentication")) {
        return GhAvailability.UNAUTH
    }
    if (rateLimited(text)) return GhAvailability.RATE_LIMITED
    return GhAvailability.OK
}

/**
 * Whether gh was refused for spending the token's budget rather than for anything about the query.
 *
 * Both wordings GitHub uses are matched: the primary hourly limit and the secondary limit that answers
 * bursts. Neither may fall through to "no pull request here" — that reading is both wrong and expensive,
 * because it makes the resolver try its remaining strategies against a limit that will refuse them too.
 */
internal fun rateLimited(text: String): Boolean {
    if (text.contains("rate limit") || text.contains("rate-limit")) return true
    return text.contains("abuse detection") || text.contains("too many requests")
}

private val json = Json { ignoreUnknownKeys = true }

private val LOG = KiloLog.create(PrResolver::class.java)
