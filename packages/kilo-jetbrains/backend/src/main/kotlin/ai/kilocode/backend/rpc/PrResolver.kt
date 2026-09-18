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
import java.util.concurrent.ConcurrentHashMap

/**
 * Budgets for `gh` reads.
 *
 * [GH_READ_TIMEOUT_MS] bounds an ordinary lookup; [GH_PROBE_TIMEOUT_MS] bounds the selector-less
 * `gh pr view`, which has been observed hanging indefinitely inside a worktree. Both replace a single
 * 30s budget that let one hanging command occupy a poll slot for an entire poll interval.
 */
internal const val GH_READ_TIMEOUT_MS = 10_000
internal const val GH_PROBE_TIMEOUT_MS = 5_000

/**
 * How long "this commit has no pull request" may be reused. See [PrResolver.absent].
 *
 * Long, because it is keyed by commit: the answer can only go stale if a pull request is opened for a
 * head that is already pushed, without anything happening locally. A return to the IDE passes its own
 * freshness ceiling and re-checks anyway, so this only ever bounds the background poll.
 */
internal const val PR_ABSENT_TTL = 600_000L

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
    // A checkout deleted mid-poll fails before `gh` runs, with `Cannot start a process, the working
    // directory '...' does not exist` — which the field test below reads as a rejected field name. That
    // is a race against one directory, not something this `gh` cannot do, and both callers latch on
    // FIELD: one lost `gh` call would strip review, CI, and conversation state from every worktree in
    // the IDE until it restarted. Agent Manager deletes worktrees routinely, so it happens for real.
    if (badDir(stderr)) return null
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
    private val gh: (Path, List<String>, Int) -> CmdOut,
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
     * Checkouts whose head commit the ladder has already proven has no pull request, by path.
     *
     * The expensive case this exists for is a worktree with no PR at all: it is the only one that runs
     * every strategy to completion, so it costs the most `gh` calls of any row and does it on every
     * poll, forever. Keyed by head commit rather than by time alone, so it is spent the moment anything
     * is committed, reset, rebased, or checked out — the events that could give the branch a pull
     * request — and only the "nothing happened here" case is actually reused.
     */
    private val absent = ConcurrentHashMap<String, Absent>()

    /** A proven-absent pull request for one checkout at one commit. */
    private data class Absent(val head: String, val time: Long)

    /**
     * Resolves the PR for the checkout at [path] on [branch]. [base] is the repository's base
     * branch; a PR headed by it is not worth a search query, so strategy 3 is skipped there.
     *
     * [maxAge] is the caller's ceiling on how stale a reused "no pull request here" may be, carried
     * from the same parameter on the RPC so a caller that rejected the backend's PR list does not then
     * get served this resolver's own cached absence underneath it.
     */
    fun resolve(path: String, branch: String, base: String?, maxAge: Long? = null): PrLookup {
        val dir = Path.of(path).normalize()
        return comments(dir, find(dir, path, branch, base, maxAge))
    }

    /** Drops every proven-absent entry, for a mutation that can have created a pull request. */
    fun clear() {
        absent.clear()
    }

    /**
     * The strategy ladder, answering with the PR alone — no review conversations yet.
     *
     * Naming the branch comes first: the selector-less form is the one observed hanging indefinitely
     * in a worktree, and for an Agent Manager worktree the branch is always known. The selector-less
     * form still runs afterwards, on a short budget, because it is the only one that resolves a fork
     * PR through `branch.<name>.merge`.
     *
     * The head commit is read up front — one local `git rev-parse`, against the three networked `gh`
     * spawns a full ladder costs — so [absent] can answer a checkout that has already been proven to
     * have no pull request without running the ladder at all. [search] is then handed the same commit
     * rather than reading it again.
     */
    private fun find(dir: Path, path: String, branch: String, base: String?, maxAge: Long?): PrLookup {
        val head = git(dir, listOf("rev-parse", "HEAD")).stdout.trim()
        if (spent(path, head, maxAge)) return PrLookup()
        val slow = Timeouts()
        view(dir, path, branch, GH_READ_TIMEOUT_MS, slow)?.let { return it }
        // Strategies 2 and 3 exist for heads the branch name alone cannot reach — a fork PR resolved
        // through `branch.<name>.merge`, a `refs/pull/N/head` checkout, a branch renamed locally. The
        // working tree holding the repository's own base branch is none of those (git will not let a
        // second worktree check that branch out, so this is the main one), and it is the row that pays
        // for them on every single poll: it reliably has no pull request, so it always falls through to
        // the end of the ladder. Skipping both there is what stops the base-branch row from spending the
        // hang-prone selector-less budget forever to re-learn the same answer.
        if (branch != base) {
            view(dir, path, null, GH_PROBE_TIMEOUT_MS, slow)?.let { return it }
            search(dir, path, head, slow)?.let { return it }
        }
        // Nothing answered. A ladder that timed out has not established that there is no PR, so it
        // must not report one absent — the frontend keeps the previous answer for an unavailable gh.
        if (slow.hit) return PrLookup(availability = GhAvailability.TIMEOUT)
        // Only a ladder that ran to completion proves an absence worth remembering.
        remember(path, head)
        return PrLookup()
    }

    /**
     * Whether [path] at [head] is already known to have no pull request, within [maxAge].
     *
     * A blank [head] means `git rev-parse` could not answer (an empty repository, or a checkout that
     * vanished mid-poll), which is not a commit this can be keyed by — so it never hits and never
     * records, and the ladder runs exactly as it did before.
     */
    private fun spent(path: String, head: String, maxAge: Long?): Boolean {
        if (head.isEmpty()) return false
        val entry = absent[path] ?: return false
        if (entry.head != head) return false
        if (!usable(entry.time, System.currentTimeMillis(), PR_ABSENT_TTL, maxAge)) return false
        LOG.debug { "pr lookup skipped, no pull request known for this commit: path=$path head=$head" }
        return true
    }

    private fun remember(path: String, head: String) {
        if (head.isEmpty()) return
        absent[path] = Absent(head, System.currentTimeMillis())
    }

    /** Records whether any strategy in one ladder run exceeded its budget. */
    private class Timeouts {
        var hit = false
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
        val out = gh(dir, listOf("api", "graphql", "-f", "query=$THREADS_QUERY", "-f", "id=${found.node}"), GH_READ_TIMEOUT_MS)
        if (out.ok) return found.copy(pr = pr.copy(comments = parseThreads(out.stdout)))
        // A killed process flushes no stderr, so neither the rate-limit nor the refusal test below can
        // see a timeout. Left to fall through it would return `found` with the default count, reading
        // as "every conversation settled" — the same position as a refusal, so reported the same way.
        if (out.timeout) return PrLookup(availability = GhAvailability.TIMEOUT)
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
    private fun view(dir: Path, path: String, branch: String?, timeoutMs: Int, slow: Timeouts): PrLookup? {
        val out = query(dir, timeoutMs) { fields ->
            buildList {
                add("pr")
                add("view")
                branch?.let { add(it) }
                add("--json")
                add(fields)
            }
        }
        if (!out.ok) return unusable(out, slow)
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
    private fun query(dir: Path, timeoutMs: Int = GH_READ_TIMEOUT_MS, command: (String) -> List<String>): CmdOut {
        val wanted = if (rich) PR_RICH_FIELDS else PR_FIELDS
        val out = gh(dir, command(wanted), timeoutMs)
        if (out.ok || wanted == PR_FIELDS) return out
        // A spent budget refuses the scalar form just as readily, so retrying only burns another call.
        if (rateLimited(out.stderr.lowercase())) return out
        val refusal = richRefusal(out.stderr) ?: return out
        if (refusal == RichRefusal.FIELD) {
            rich = false
            LOG.info("gh cannot answer review/CI fields, falling back to scalars: ${out.stderr.trim()}")
        }
        return gh(dir, command(PR_FIELDS), timeoutMs)
    }

    /** Strategy 3. [head] is the checkout's head commit, already read by [find]. */
    private fun search(dir: Path, path: String, head: String, slow: Timeouts): PrLookup? {
        if (head.isEmpty()) return null
        val out = query(dir) { fields ->
            listOf("pr", "list", "--state", "all", "--search", "$head is:pr", "--limit", "5", "--json", "$fields,headRefOid")
        }
        if (!out.ok) return unusable(out, slow)
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

    /**
     * A timed-out lookup is not evidence that the PR does not exist, so it does not end the ladder —
     * but it is recorded, so a ladder that never answers reports a timeout instead of "no PR".
     */
    private fun unusable(out: CmdOut, slow: Timeouts): PrLookup? {
        if (out.timeout) {
            slow.hit = true
            return null
        }
        val status = prError(out.stderr)
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
