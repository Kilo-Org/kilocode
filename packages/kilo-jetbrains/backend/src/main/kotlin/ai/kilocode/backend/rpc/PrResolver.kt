package ai.kilocode.backend.rpc

import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Path

/** Result of running a `git`/`gh` command. */
internal data class CmdOut(
    val exit: Int,
    val stdout: String,
    val stderr: String,
    /** True when the process was killed for exceeding its timeout, so [exit] `-1` reads as a real
     * failure reason instead of an unexplained one. */
    val timeout: Boolean = false,
) {
    val ok get() = exit == 0
}

/** PR for one checkout, plus the gh availability observed while resolving it. */
internal data class PrLookup(
    val pr: WorktreePrDto? = null,
    val availability: GhAvailability = GhAvailability.OK,
    /**
     * The pull request's GraphQL node id, which addresses the follow-up review-thread query. Empty when
     * no PR was found or when `gh` answered without one.
     */
    val node: String = "",
)

/** Scalar fields every supported `gh` release and token can answer. */
internal const val PR_FIELDS = "id,number,state,isDraft,url,title"

/**
 * [PR_FIELDS] plus the review verdict, the CI rollup, and mergeability. None of the three is a plain
 * column on the pull request — two are GraphQL sub-queries and the third is computed on demand — so an
 * older `gh` rejects the field names outright and a restricted token is refused the data. See
 * [richRefusal] for how that is detected and [PrResolver] for the fallback.
 *
 * Mergeability rides this list rather than [PR_FIELDS] deliberately: it costs nothing extra here, and a
 * `gh` old enough to refuse the CI rollup should not lose the pull request itself over a conflict marker.
 */
internal const val PR_RICH_FIELDS = "$PR_FIELDS,reviewDecision,statusCheckRollup,mergeable"

/**
 * Review-conversation resolution flags for one pull request, addressed by node id.
 *
 * `reviewThreads` is GraphQL only — `gh pr view --json reviewThreads` answers `Unknown JSON field` on
 * every release — so the unresolved count costs a second `gh` invocation whatever this asks for.
 *
 * Addressed by node id rather than owner/repo/number so it works on GitHub Enterprise, whose pull request
 * urls do not match github.com and so cannot be parsed for a repository. `gh api` takes the host from the
 * checkout it runs in, so the same command serves both.
 *
 * Only the flags are requested. Comment bodies, authors, and diff hunks would multiply the payload and the
 * query's point cost to say nothing a badge shows.
 */
internal const val THREADS_QUERY =
    "query(\$id: ID!) { node(id: \$id) { ... on PullRequest { reviewThreads(first: 100) { totalCount nodes { isResolved } } } } }"

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

    // Same reasoning as [rich], for the review-thread query.
    @Volatile
    private var threads = true

    /**
     * Resolves the PR for the checkout at [path] on [branch]. [base] is the repository's base
     * branch; a PR headed by it is not worth a search query, so strategy 3 is skipped there.
     */
    fun resolve(path: String, branch: String, base: String?): PrLookup {
        val dir = Path.of(path).normalize()
        return comments(dir, find(dir, path, branch, base))
    }

    /** The strategy ladder, answering with the PR alone — no review conversations yet. */
    private fun find(dir: Path, path: String, branch: String, base: String?): PrLookup {
        view(dir, path, null)?.let { return it }
        view(dir, path, branch)?.let { return it }
        if (branch == base) return PrLookup()
        return search(dir, path) ?: PrLookup()
    }

    /**
     * [found], with the pull request's unresolved review-conversation count filled in.
     *
     * Only live pull requests pay for it. The query is a process spawn per row per poll, and unresolved
     * feedback on something already merged or closed is not work anyone is waiting on.
     *
     * A spent budget answers nothing about this pull request, and the DTO's default count reads as "every
     * conversation settled" — so it is reported the way a refused `gh pr view` is, with no PR at all. That
     * is what lets the frontend's `held` keep the previous answer, count included, instead of blanking a
     * conversation badge for the best part of an hour over a lookup that never ran.
     *
     * Only a rejected field name latches the query off, exactly as [RichRefusal.FIELD] does for review and
     * CI fields: it is the one failure true of every repository this process sees, so a `gh` that cannot
     * answer threads costs one call in total rather than one per checkout on every poll. A per-repository
     * access refusal or a transient failure costs this poll's count and nothing else — one resolver serves
     * every checkout, so latching on those would strip the badge from every other worktree until the IDE
     * restarts.
     */
    private fun comments(dir: Path, found: PrLookup): PrLookup {
        val pr = found.pr ?: return found
        if (pr.state != GhState.OPEN && pr.state != GhState.DRAFT) return found
        if (!threads || found.node.isEmpty()) return found
        val out = gh(dir, listOf("api", "graphql", "-f", "query=$THREADS_QUERY", "-f", "id=${found.node}"))
        if (out.ok) return found.copy(pr = pr.copy(comments = parseThreads(out.stdout)))
        if (rateLimited(out.stderr.lowercase())) return PrLookup(availability = GhAvailability.RATE_LIMITED)
        if (richRefusal(out.stderr) == RichRefusal.FIELD) {
            threads = false
            LOG.info("gh cannot answer review threads, dropping the comment count: ${out.stderr.trim()}")
            return found
        }
        LOG.info("review thread lookup failed, will ask again next poll: ${out.stderr.trim()}")
        return found
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
        return parsePr(path, out.stdout)?.let { PrLookup(it, node = parsePrNodeId(out.stdout)) }
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
            val raw = obj.toString()
            parsePr(path, raw)?.let { return PrLookup(it, node = parsePrNodeId(raw)) }
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
