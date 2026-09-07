package ai.kilocode.backend.rpc

import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class PrResolverTest {
    private val path = "/repo/.kilo/worktrees/feature-x"
    private val calls = mutableListOf<List<String>>()

    /** The checkout the command in flight runs in, so a test can answer differently per repository. */
    private var dir = ""

    @Test
    fun `resolves through branch config without falling back`() {
        val resolver = resolver(view = { pr(7, "OPEN") })

        val lookup = resolver.resolve(path, "feature/x", base = "main")

        val pull = assertNotNull(lookup.pr)
        assertEquals(7, pull.number)
        assertEquals(path, pull.path)
        assertEquals(GhState.OPEN, pull.state)
        // The config-driven form answered, so the branch selector and the search never run. The review
        // conversations follow, which no `--json` field can answer.
        assertEquals(listOf(listOf("pr", "view", "--json", PR_RICH_FIELDS), graphql()), calls)
    }

    @Test
    fun `retries without review and ci fields when gh cannot answer them`() {
        // An older gh rejects the field name outright rather than reporting a missing PR.
        val resolver = resolver(
            view = { args ->
                if (args.contains(PR_RICH_FIELDS)) CmdOut(1, "", """Unknown JSON field: "statusCheckRollup"""")
                else pr(7, "OPEN")
            },
        )

        val lookup = resolver.resolve(path, "feature/x", base = "main")

        // Without the retry this reads as "no PR here", and the row loses a PR it has always shown.
        assertEquals(7, assertNotNull(lookup.pr, "the scalar retry must still resolve the PR").number)
        assertEquals(GhAvailability.OK, lookup.availability)
        assertEquals(
            listOf(listOf("pr", "view", "--json", PR_RICH_FIELDS), listOf("pr", "view", "--json", PR_FIELDS), graphql()),
            calls,
        )
    }

    @Test
    fun `retries without review and ci fields when the token is refused them`() {
        val resolver = resolver(
            view = { args ->
                if (args.contains(PR_RICH_FIELDS)) {
                    CmdOut(1, "", "GraphQL: Resource not accessible by integration (repository.pullRequest)")
                } else {
                    pr(11, "OPEN")
                }
            },
        )

        assertEquals(11, assertNotNull(resolver.resolve(path, "feature/x", base = "main").pr).number)
    }

    @Test
    fun `retries without review and ci fields for every wording gh uses to refuse them`() {
        // A PR the row already shows must survive each of these, so none of them may read as "no PR".
        val refusals = listOf(
            """Unknown JSON field: "statusCheckRollup"""",
            "GraphQL: Resource not accessible by personal access token (repository.pullRequest)",
            "GraphQL: Field 'statusCheckRollup' doesn't exist on type 'PullRequest'",
            "GraphQL: Field 'reviewDecision' does not exist on type 'PullRequest'",
            "HTTP 403: Forbidden (https://api.github.com/graphql)",
            "your token has insufficient scopes",
        )

        for (stderr in refusals) {
            calls.clear()
            val resolver = resolver(
                view = { args -> if (args.contains(PR_RICH_FIELDS)) CmdOut(1, "", stderr) else pr(11, "OPEN") },
            )

            val lookup = resolver.resolve(path, "feature/x", base = "main")

            assertEquals(11, assertNotNull(lookup.pr, "the scalar retry must resolve the PR for: $stderr").number)
            assertEquals(GhAvailability.OK, lookup.availability)
        }
    }

    @Test
    fun `keeps asking for review and ci fields after one repository refused the token`() {
        // One resolver serves every checkout, and a permission refusal is per repository and token, so
        // the restricted worktree must not cost the others their review/CI state.
        val restricted = "$path-restricted"
        val resolver = resolver(
            view = { args ->
                if (!args.contains(PR_RICH_FIELDS)) pr(11, "OPEN")
                else CmdOut(1, "", "GraphQL: Resource not accessible by integration (repository.pullRequest)")
            },
        )
        resolver.resolve(restricted, "feature/x", base = "main")
        calls.clear()

        resolver.resolve(path, "feature/x", base = "main")

        assertEquals(
            listOf(listOf("pr", "view", "--json", PR_RICH_FIELDS), listOf("pr", "view", "--json", PR_FIELDS), graphql()),
            calls,
        )
    }

    @Test
    fun `stops asking for review and ci fields once gh has refused them`() {
        val resolver = resolver(
            view = { args ->
                if (args.contains(PR_RICH_FIELDS)) CmdOut(1, "", """Unknown JSON field: "reviewDecision"""")
                else pr(7, "OPEN")
            },
        )
        resolver.resolve(path, "feature/x", base = "main")
        calls.clear()

        resolver.resolve(path, "feature/x", base = "main")

        // The downgrade latches, so the fallback costs one extra call in total rather than one per
        // checkout on every poll.
        assertEquals(listOf(listOf("pr", "view", "--json", PR_FIELDS), graphql()), calls)
    }

    @Test
    fun `keeps reporting an authorization failure rather than retrying scalars`() {
        val resolver = resolver(view = { CmdOut(1, "", "gh: authentication required") })

        val lookup = resolver.resolve(path, "feature/x", base = "main")

        assertEquals(GhAvailability.UNAUTH, lookup.availability)
        assertEquals(1, calls.size, "an auth failure is not a field-support problem")
    }

    @Test
    fun `falls back to the branch selector when config resolves nothing`() {
        val resolver = resolver(view = { args -> if (args.contains("feature/x")) pr(8, "DRAFT") else missing() })

        val lookup = resolver.resolve(path, "feature/x", base = "main")

        assertEquals(8, assertNotNull(lookup.pr).number)
        assertEquals(GhState.DRAFT, lookup.pr?.state)
        assertEquals(
            listOf(listOf("pr", "view", "--json", PR_RICH_FIELDS), listOf("pr", "view", "feature/x", "--json", PR_RICH_FIELDS), graphql()),
            calls,
            "the head search should not run once the branch selector answered",
        )
    }

    @Test
    fun `carries review and ci state through to the resolved pull request`() {
        val resolver = resolver(
            view = {
                ok(
                    """
                    {"id":"$NODE","number":12,"state":"OPEN","isDraft":false,"url":"https://pr/12","title":"Work",
                     "reviewDecision":"APPROVED",
                     "statusCheckRollup":[{"conclusion":"SUCCESS"},{"conclusion":"FAILURE"},{"conclusion":"SKIPPED"}]}
                    """.trimIndent(),
                )
            },
        )

        val pull = assertNotNull(resolver.resolve(path, "feature/x", base = "main").pr)

        assertEquals(GhReview.APPROVED, pull.review)
        assertEquals(GhChecks.FAILED, pull.checks.state)
        assertEquals(2, pull.checks.total, "a skipped check is not counted")
    }

    @Test
    fun `falls back to searching the head commit`() {
        val resolver = resolver(
            view = { missing() },
            list = { ok("""[{"id":"$NODE","number":9,"state":"MERGED","isDraft":false,"url":"https://pr/9","title":"Fork work","headRefOid":"$SHA"}]""") },
        )

        val lookup = resolver.resolve(path, "renamed-locally", base = "main")

        val pull = assertNotNull(lookup.pr, "an exact head match should resolve the PR")
        assertEquals(9, pull.number)
        assertEquals(GhState.MERGED, pull.state)
        assertTrue(calls.any { it.contains("$SHA is:pr") }, "the search should use the head sha")
    }

    @Test
    fun `rejects a search hit whose head commit differs`() {
        val resolver = resolver(
            view = { missing() },
            // The GitHub search also matches PRs that merely mention the commit.
            list = { ok("""[{"number":9,"state":"OPEN","isDraft":false,"url":"https://pr/9","headRefOid":"deadbeef"}]""") },
        )

        assertNull(resolver.resolve(path, "renamed-locally", base = "main").pr)
    }

    @Test
    fun `skips the head search for the base branch`() {
        val resolver = resolver(view = { missing() }, list = { throw IllegalStateException("must not search") })

        assertNull(resolver.resolve("/repo", "main", base = "main").pr)
        assertEquals(2, calls.size, "only the two view forms should run for the base branch")
    }

    @Test
    fun `reports an authorization failure instead of a missing pull request`() {
        val resolver = resolver(view = { CmdOut(1, "", "gh auth login required") })

        val lookup = resolver.resolve(path, "feature/x", base = "main")

        assertNull(lookup.pr)
        assertEquals(GhAvailability.UNAUTH, lookup.availability)
        assertEquals(1, calls.size, "an unusable gh must stop the ladder immediately")
    }

    @Test
    fun `reports a spent budget instead of walking the ladder against it`() {
        // Both wordings GitHub answers with, primary and secondary.
        val limits = listOf(
            "HTTP 403: API rate limit exceeded for user ID 1. (https://api.github.com/graphql)",
            "GraphQL: You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
        )

        for (stderr in limits) {
            calls.clear()
            val resolver = resolver(view = { CmdOut(1, "", stderr) }, list = { throw IllegalStateException("must not search") })

            val lookup = resolver.resolve(path, "feature/x", base = "main")

            assertEquals(GhAvailability.RATE_LIMITED, lookup.availability, "for: $stderr")
            assertNull(lookup.pr)
            // The remaining strategies would be refused by the same limit, so a lookup that reads as
            // "no PR here" would cost three calls per checkout at the worst possible moment.
            assertEquals(1, calls.size, "a spent budget must stop the ladder immediately, got $calls")
        }
    }

    @Test
    fun `does not retry the scalar fields when the budget is spent`() {
        val resolver = resolver(view = { CmdOut(1, "", "API rate limit exceeded") })

        resolver.resolve(path, "feature/x", base = "main")

        // The scalar form is refused just as readily, so the field-support fallback must not fire.
        assertEquals(listOf(listOf("pr", "view", "--json", PR_RICH_FIELDS)), calls)
    }

    @Test
    fun `carries the unresolved review conversation count through to the resolved pull request`() {
        val resolver = resolver(view = { pr(7, "OPEN") }, api = { threads(unresolved = 3, resolved = 5) })

        val pull = assertNotNull(resolver.resolve(path, "feature/x", base = "main").pr)

        assertEquals(3, pull.comments.unresolved)
        assertEquals(8, pull.comments.total, "the total counts every conversation, settled or not")
    }

    @Test
    fun `skips the review conversation lookup for a merged or closed pull request`() {
        // Unresolved feedback on something already merged is not work anyone is waiting on, and the
        // lookup is a process spawn per row on every poll.
        for (state in listOf("MERGED", "CLOSED")) {
            calls.clear()
            val resolver = resolver(
                view = { pr(7, state) },
                api = { throw IllegalStateException("must not ask about review threads for $state") },
            )

            val pull = assertNotNull(resolver.resolve(path, "feature/x", base = "main").pr)

            assertEquals(0, pull.comments.unresolved, "for: $state")
            assertEquals(listOf(listOf("pr", "view", "--json", PR_RICH_FIELDS)), calls, "for: $state")
        }
    }

    @Test
    fun `asks about review conversations for a draft pull request`() {
        // A draft is still being worked on, which is exactly when review feedback is outstanding.
        val resolver = resolver(view = { pr(7, "DRAFT") }, api = { threads(unresolved = 1) })

        assertEquals(1, assertNotNull(resolver.resolve(path, "feature/x", base = "main").pr).comments.unresolved)
    }

    @Test
    fun `reports a spent budget from the review conversation lookup without a pull request`() {
        // The count is unknown and the DTO's default reads as "every conversation settled", so answering
        // with the PR would publish a resolution nobody made and hold it for the rate-limit window. Told
        // the way a refused `gh pr view` is instead, which is what lets the frontend keep its last answer.
        val resolver = resolver(view = { pr(7, "OPEN") }, api = { CmdOut(1, "", "API rate limit exceeded") })

        val lookup = resolver.resolve(path, "feature/x", base = "main")

        assertEquals(GhAvailability.RATE_LIMITED, lookup.availability)
        assertNull(lookup.pr, "a PR carrying a zeroed count would blank a conversation badge already shown")
    }

    @Test
    fun `keeps the pull request and latches when gh rejects the review conversation field`() {
        // The one failure that is true of every repository this process sees, so it may latch.
        val resolver = resolver(
            view = { pr(7, "OPEN") },
            api = { CmdOut(1, "", "GraphQL: Field 'reviewThreads' doesn't exist on type 'PullRequest'") },
        )

        val first = resolver.resolve(path, "feature/x", base = "main")
        calls.clear()
        val second = resolver.resolve(path, "feature/x", base = "main")

        assertEquals(7, assertNotNull(first.pr, "a rejected field must not cost the row its PR").number)
        assertEquals(GhAvailability.OK, first.availability, "a refusal is not a reason to hold every badge")
        assertEquals(7, assertNotNull(second.pr).number)
        // Latched, so a gh that cannot read threads costs one call in total rather than one per poll.
        assertEquals(listOf(listOf("pr", "view", "--json", PR_RICH_FIELDS)), calls)
    }

    @Test
    fun `keeps asking about review conversations after one repository refused the token`() {
        // One resolver serves every checkout and an access refusal is per repository and token, so the
        // restricted worktree must not cost the others their conversation count until the IDE restarts.
        val restricted = "$path-restricted"
        val resolver = resolver(
            view = { pr(7, "OPEN") },
            api = {
                if (dir == restricted) CmdOut(1, "", "GraphQL: Resource not accessible by integration (repository)")
                else threads(unresolved = 2)
            },
        )

        val refused = resolver.resolve(restricted, "feature/x", base = "main")
        val other = resolver.resolve(path, "feature/x", base = "main")

        assertEquals(7, assertNotNull(refused.pr, "a refused count must not cost the row its PR").number)
        assertEquals(GhAvailability.OK, refused.availability, "one restricted repository holds no badges")
        assertEquals(0, refused.pr?.comments?.unresolved)
        assertEquals(2, other.pr?.comments?.unresolved, "the second checkout still gets its count")
    }

    @Test
    fun `keeps asking about review conversations after a transient failure`() {
        // A gateway error or a dropped connection says nothing about whether gh can answer threads at
        // all, so it costs this poll's count and not the badge for every worktree until a restart.
        val answers = mutableListOf(CmdOut(1, "", "HTTP 502: Bad Gateway"), threads(unresolved = 4))
        val resolver = resolver(view = { pr(7, "OPEN") }, api = { answers.removeFirst() })

        val blip = resolver.resolve(path, "feature/x", base = "main")
        val after = resolver.resolve(path, "feature/x", base = "main")

        assertEquals(GhAvailability.OK, blip.availability)
        assertEquals(0, blip.pr?.comments?.unresolved)
        assertEquals(4, after.pr?.comments?.unresolved, "the query must still run on the next poll")
        assertTrue(answers.isEmpty(), "both answers should have been asked for")
    }

    @Test
    fun `skips the review conversation lookup when gh answered no node id`() {
        // Nothing addresses the query without one, and the alternative — parsing owner and repo out of the
        // PR url — silently skips GitHub Enterprise, whose urls are not github.com.
        val resolver = resolver(
            view = { ok("""{"number":7,"state":"OPEN","isDraft":false,"url":"https://pr/7","title":"Work"}""") },
            api = { throw IllegalStateException("must not ask about review threads without a node id") },
        )

        assertEquals(7, assertNotNull(resolver.resolve(path, "feature/x", base = "main").pr).number)
        assertEquals(listOf(listOf("pr", "view", "--json", PR_RICH_FIELDS)), calls)
    }

    @Test
    fun `treats a missing pull request as a clean result`() {
        val resolver = resolver(view = { missing() }, list = { ok("[]") })

        val lookup = resolver.resolve(path, "feature/x", base = "main")

        assertNull(lookup.pr)
        assertEquals(GhAvailability.OK, lookup.availability)
    }

    private fun resolver(
        view: (List<String>) -> CmdOut,
        list: (List<String>) -> CmdOut = { ok("[]") },
        api: (List<String>) -> CmdOut = { threads() },
    ): PrResolver = PrResolver(
        gh = { at, args ->
            dir = at.toString()
            calls.add(args)
            when {
                args.firstOrNull() == "api" -> api(args)
                args.getOrNull(1) == "list" -> list(args)
                else -> view(args)
            }
        },
        git = { at, args ->
            dir = at.toString()
            calls.add(args)
            assertEquals(listOf("rev-parse", "HEAD"), args)
            ok("$SHA\n")
        },
    )

    private fun pr(number: Int, state: String): CmdOut = ok(
        """{"id":"$NODE","number":$number,"state":"$state","isDraft":${state == "DRAFT"},""" +
            """"url":"https://pr/$number","title":"Work"}""",
    )

    /** A `reviewThreads` response with [unresolved] open conversations and [resolved] settled ones. */
    private fun threads(unresolved: Int = 0, resolved: Int = 0): CmdOut {
        val nodes = List(unresolved) { """{"isResolved":false}""" } + List(resolved) { """{"isResolved":true}""" }
        return ok(
            """{"data":{"node":{"reviewThreads":{"totalCount":${nodes.size},"nodes":[${nodes.joinToString(",")}]}}}}""",
        )
    }

    /** The review-thread lookup, as it lands in [calls]. */
    private fun graphql() = listOf("api", "graphql", "-f", "query=$THREADS_QUERY", "-f", "id=$NODE")

    private fun ok(stdout: String) = CmdOut(0, stdout, "")

    private fun missing() = CmdOut(1, "", "no pull requests found for branch \"feature/x\"")

    private companion object {
        const val SHA = "1111111111111111111111111111111111111111"
        const val NODE = "PR_kwDOAbCdEf"
    }
}
