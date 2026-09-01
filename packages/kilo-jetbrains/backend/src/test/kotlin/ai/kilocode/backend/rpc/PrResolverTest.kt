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

    @Test
    fun `resolves through branch config without falling back`() {
        val resolver = resolver(view = { pr(7, "OPEN") })

        val lookup = resolver.resolve(path, "feature/x", base = "main")

        val pull = assertNotNull(lookup.pr)
        assertEquals(7, pull.number)
        assertEquals(path, pull.path)
        assertEquals(GhState.OPEN, pull.state)
        // The config-driven form answered, so the branch selector and the search never run.
        assertEquals(listOf(listOf("pr", "view", "--json", PR_RICH_FIELDS)), calls)
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
            listOf(listOf("pr", "view", "--json", PR_RICH_FIELDS), listOf("pr", "view", "--json", PR_FIELDS)),
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
            listOf(listOf("pr", "view", "--json", PR_RICH_FIELDS), listOf("pr", "view", "--json", PR_FIELDS)),
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
        assertEquals(listOf(listOf("pr", "view", "--json", PR_FIELDS)), calls)
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
        assertEquals(2, calls.size, "the head search should not run once the branch selector answered")
    }

    @Test
    fun `carries review and ci state through to the resolved pull request`() {
        val resolver = resolver(
            view = {
                ok(
                    """
                    {"number":12,"state":"OPEN","isDraft":false,"url":"https://pr/12","title":"Work",
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
            list = { ok("""[{"number":9,"state":"MERGED","isDraft":false,"url":"https://pr/9","title":"Fork work","headRefOid":"$SHA"}]""") },
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
    fun `treats a missing pull request as a clean result`() {
        val resolver = resolver(view = { missing() }, list = { ok("[]") })

        val lookup = resolver.resolve(path, "feature/x", base = "main")

        assertNull(lookup.pr)
        assertEquals(GhAvailability.OK, lookup.availability)
    }

    private fun resolver(
        view: (List<String>) -> CmdOut,
        list: (List<String>) -> CmdOut = { ok("[]") },
    ): PrResolver = PrResolver(
        gh = { _, args ->
            calls.add(args)
            if (args.getOrNull(1) == "list") list(args) else view(args)
        },
        git = { _, args ->
            calls.add(args)
            assertEquals(listOf("rev-parse", "HEAD"), args)
            ok("$SHA\n")
        },
    )

    private fun pr(number: Int, state: String): CmdOut =
        ok("""{"number":$number,"state":"$state","isDraft":${state == "DRAFT"},"url":"https://pr/$number","title":"Work"}""")

    private fun ok(stdout: String) = CmdOut(0, stdout, "")

    private fun missing() = CmdOut(1, "", "no pull requests found for branch \"feature/x\"")

    private companion object {
        const val SHA = "1111111111111111111111111111111111111111"
    }
}
