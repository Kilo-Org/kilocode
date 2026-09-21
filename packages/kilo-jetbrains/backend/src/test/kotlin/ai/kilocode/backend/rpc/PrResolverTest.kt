package ai.kilocode.backend.rpc

import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class PrResolverTest {
    private val path = "/repo/.kilo/worktrees/feature-x"
    private val calls = mutableListOf<List<String>>()
    /** Timeout budget each `gh` call was given, so the short probe budget stays verifiable. */
    private val budgets = mutableListOf<Int>()

    /**
     * The local `git` reads, kept apart from the networked [calls] the ladder assertions are about.
     * Every entry is the head-commit read, which the resolver now takes once up front rather than only
     * inside the search strategy — so how many of these ran is its own claim, not part of a ladder.
     */
    private val heads = mutableListOf<List<String>>()

    /** The checkout the command in flight runs in, so a test can answer differently per repository. */
    private var dir = ""

    /** What `git rev-parse HEAD` answers, so a test can move the commit under a cached absence. */
    private var head = "$SHA\n"

    @Test
    fun `resolves through the branch selector without falling back`() {
        val resolver = resolver(view = { pr(7, "OPEN") })

        val lookup = resolver.resolve(path, "feature/x", base = "main")

        val pull = assertNotNull(lookup.pr)
        assertEquals(7, pull.number)
        assertEquals(path, pull.path)
        assertEquals(GhState.OPEN, pull.state)
        // Naming the branch is the first strategy — the selector-less form is the one that has been
        // seen hanging — so nothing else runs but the review conversations, which no `--json` field
        // can answer.
        assertEquals(listOf(listOf("pr", "view", "feature/x", "--json", PR_RICH_FIELDS), graphql()), calls)
        assertEquals(listOf(GH_READ_TIMEOUT_MS, GH_READ_TIMEOUT_MS), budgets)
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
        assertEquals(listOf(listOf("pr", "view", "feature/x", "--json", PR_RICH_FIELDS), listOf("pr", "view", "feature/x", "--json", PR_FIELDS), graphql()), calls)
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

        assertEquals(listOf(listOf("pr", "view", "feature/x", "--json", PR_RICH_FIELDS), listOf("pr", "view", "feature/x", "--json", PR_FIELDS), graphql()), calls)
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
        assertEquals(listOf(listOf("pr", "view", "feature/x", "--json", PR_FIELDS), graphql()), calls)
    }

    @Test
    fun `keeps asking for review and ci fields after a checkout vanished mid-poll`() {
        // A worktree deleted while a poll is in flight fails the spawn, not the query. The message
        // carries "does not exist", so it used to read as a rejected field name and latch the downgrade
        // for the whole backend: every row kept its PR number and silently lost its approved and checks
        // badges until the IDE restarted.
        val vanished = "$path-deleted"
        val resolver = resolver(
            view = { if (dir == vanished) gone(vanished) else pr(7, "OPEN") },
            list = { if (dir == vanished) gone(vanished) else ok("[]") },
            api = { if (dir == vanished) gone(vanished) else threads() },
        )

        val lost = resolver.resolve(vanished, "feature/x", base = "main")
        calls.clear()
        val live = resolver.resolve(path, "feature/x", base = "main")

        assertNull(lost.pr, "a checkout that no longer exists has no pull request to report")
        assertEquals(GhAvailability.OK, lost.availability, "a deleted worktree is not a gh problem")
        assertEquals(7, assertNotNull(live.pr).number)
        assertEquals(listOf(listOf("pr", "view", "feature/x", "--json", PR_RICH_FIELDS), graphql()), calls)
    }

    @Test
    fun `keeps asking about review conversations after a checkout vanished mid-poll`() {
        // The same race one call later: the view answered, then the delete landed, so only the thread
        // query fails to spawn. Latching there costs every other worktree its conversation badge.
        val vanished = "$path-deleted"
        val resolver = resolver(
            view = { pr(7, "OPEN") },
            api = { if (dir == vanished) gone(vanished) else threads(unresolved = 2) },
        )

        val lost = resolver.resolve(vanished, "feature/x", base = "main")
        val live = resolver.resolve(path, "feature/x", base = "main")

        assertEquals(GhAvailability.OK, lost.availability)
        assertEquals(0, lost.pr?.comments?.unresolved)
        assertEquals(2, live.pr?.comments?.unresolved, "the query must still run for a live checkout")
    }

    @Test
    fun `does not read a vanished working directory as a refused field`() {
        // Both shapes of the same race: the platform refusing to spawn into a gone directory, and git
        // losing the directory after it started.
        assertNull(richRefusal("Cannot start a process, the working directory '$path' does not exist"))
        assertNull(richRefusal("fatal: Unable to read current working directory: No such file or directory"))
        // The wordings that really are a refused field must still latch.
        assertEquals(RichRefusal.FIELD, richRefusal("""Unknown JSON field: "reviewDecision""""))
    }

    @Test
    fun `keeps reporting an authorization failure rather than retrying scalars`() {
        val resolver = resolver(view = { CmdOut(1, "", "gh: authentication required") })

        val lookup = resolver.resolve(path, "feature/x", base = "main")

        assertEquals(GhAvailability.UNAUTH, lookup.availability)
        assertEquals(1, calls.size, "an auth failure is not a field-support problem")
    }

    @Test
    fun `falls back to branch config when the branch selector resolves nothing`() {
        // A fork PR checked out with `gh pr checkout`: the branch name matches nothing, and only the
        // selector-less form resolves it through `branch.<name>.merge`.
        val resolver = resolver(view = { args -> if (args.contains("feature/x")) missing() else pr(8, "DRAFT") })

        val lookup = resolver.resolve(path, "feature/x", base = "main")

        assertEquals(8, assertNotNull(lookup.pr).number)
        assertEquals(GhState.DRAFT, lookup.pr?.state)
        assertEquals(
            listOf(listOf("pr", "view", "feature/x", "--json", PR_RICH_FIELDS), listOf("pr", "view", "--json", PR_RICH_FIELDS), graphql()),
            calls,
            "the head search should not run once branch config answered",
        )
        // The hanging form runs on the short probe budget, not the ordinary read budget.
        assertEquals(listOf(GH_READ_TIMEOUT_MS, GH_PROBE_TIMEOUT_MS, GH_READ_TIMEOUT_MS), budgets)
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
    fun `still asks branch config for the working tree whose branch is the base branch`() {
        // `base` is whatever branch the main working tree is on, not the repository's default branch, so
        // `branch == base` is also true right after `gh pr checkout` in the primary checkout. Skipping
        // the selector-less form there dropped the only strategy that resolves a fork PR or a
        // `refs/pull/N/head` head, and `absent` would then have cached that false absence for 10 minutes.
        val resolver = resolver(view = { args -> if (args.contains("fork-work")) missing() else pr(7, "OPEN") })

        val lookup = resolver.resolve("/repo", "fork-work", base = "fork-work")

        assertEquals(7, assertNotNull(lookup.pr, "branch config must still be consulted").number)
    }

    @Test
    fun `stops re-asking about a checkout already proven to have no pull request`() {
        val resolver = resolver(view = { missing() })

        assertNull(resolver.resolve(path, "feature/x", base = "main").pr)
        val first = calls.size
        assertTrue(first >= 2, "a PR-less branch should have walked the ladder once, got $calls")
        calls.clear()

        // Same checkout, same commit, nothing happened locally. This is the row that costs the most of
        // any: it is the only one that runs every strategy to completion, and it did so on every poll
        // forever. The ladder is what made the machine slow enough to miss a budget in the first place.
        assertNull(resolver.resolve(path, "feature/x", base = "main").pr)
        assertEquals(emptyList(), calls, "a proven absence must not be re-bought")
        assertEquals(2, heads.size, "the commit is what the absence is keyed by, so it must be re-read")
    }

    @Test
    fun `re-asks once the commit moves under a proven absence`() {
        val resolver = resolver(view = { if (head.startsWith(SHA)) missing() else pr(7, "OPEN") })

        assertNull(resolver.resolve(path, "feature/x", base = "main").pr)
        calls.clear()

        // Committing, amending, rebasing, resetting or checking out is what can give the branch a pull
        // request, and every one of them moves HEAD. Keying the absence to the commit is what makes it
        // expire on exactly those events instead of on a clock.
        head = "2222222222222222222222222222222222222222\n"
        assertEquals(7, assertNotNull(resolver.resolve(path, "feature/x", base = "main").pr).number)
        assertTrue(calls.isNotEmpty(), "a moved commit is a different question and must be asked")
    }

    @Test
    fun `re-asks when the caller will not accept an answer this old`() {
        val resolver = resolver(view = { missing() })

        assertNull(resolver.resolve(path, "feature/x", base = "main").pr)
        calls.clear()

        // A pull request can be opened on github.com for a head that is already pushed, with nothing
        // happening locally to move the commit. maxAge is how a caller returning to the IDE after a real
        // absence says it will not accept an answer that predates the absence — the same ceiling it
        // already applies to every other cache — so that return still re-checks.
        assertNull(resolver.resolve(path, "feature/x", base = "main", maxAge = 0).pr)
        assertTrue(calls.isNotEmpty(), "a rejected ceiling must reach gh, got $calls")
    }

    @Test
    fun `does not remember an absence a timed-out ladder never established`() {
        val resolver = resolver(view = { CmdOut(-1, "", "", timeout = true) })

        assertEquals(GhAvailability.TIMEOUT, resolver.resolve(path, "feature/x", base = "main").availability)
        calls.clear()

        // A spent budget answered nothing. Remembering it as "no pull request here" would turn one slow
        // command into a checkout that silently shows no PR for the whole absence TTL.
        assertEquals(GhAvailability.TIMEOUT, resolver.resolve(path, "feature/x", base = "main").availability)
        assertTrue(calls.isNotEmpty(), "a non-answer must not be cached as an answer")
    }

    @Test
    fun `does not remember an absence a transient failure never established`() {
        // prError reports an unrecognised stderr as OK, because a missing PR is the normal case and a
        // broken gh is caught by the upfront probe. So every one of these reaches the end of the ladder
        // looking exactly like "no pull request here" while having established nothing at all.
        val blips = listOf(
            "dial tcp: lookup api.github.com: no such host",
            "HTTP 502: Bad Gateway",
            "unexpected EOF",
            "connection refused",
            "error connecting to api.github.com",
        )
        for (blip in blips) {
            calls.clear()
            val resolver = resolver(view = { CmdOut(1, "", blip) }, list = { CmdOut(1, "", blip) })

            assertNull(resolver.resolve(path, "feature/x", base = "main").pr, "for: $blip")
            calls.clear()

            // Costing one poll this was fine. Cached as a proven absence it suppresses a real badge for
            // the full PR_ABSENT_TTL.
            assertNull(resolver.resolve(path, "feature/x", base = "main").pr, "for: $blip")
            assertTrue(calls.isNotEmpty(), "a blip must not be remembered as an absence: $blip")
        }
    }

    @Test
    fun `remembers an absence gh positively reported`() {
        // The counterpart to the blips above: this is the wording that actually means "there is no pull
        // request", and it is the only thing the absence cache may be built on.
        assertTrue(vacant("""no pull requests found for branch "feature/x""""))
        assertTrue(vacant("""no pull request found for branch "feature/x""""))
        assertFalse(vacant("HTTP 502: Bad Gateway"))
        assertFalse(vacant(""))
    }

    @Test
    fun `does not remember an absence when a clean gh pr view could not be read`() {
        // gh's real "there is no pull request" arrives as a *failure* with that wording. A clean exit
        // whose body does not decode is an unexplained answer, not a negative one, so the ladder must not
        // fall through it into a ten-minute cached absence.
        for (body in listOf("", "   ", "not json at all", "{}", """{"number":"not-a-number"}""")) {
            calls.clear()
            val resolver = resolver(view = { ok(body) })

            assertNull(resolver.resolve(path, "feature/x", base = "main").pr, "for: [$body]")
            calls.clear()

            assertNull(resolver.resolve(path, "feature/x", base = "main").pr, "for: [$body]")
            assertTrue(calls.isNotEmpty(), "an unreadable success must not be remembered: [$body]")
        }
    }

    @Test
    fun `does not remember an absence when the head search matched but could not be read`() {
        // The head matched, so this *is* the checkout's pull request — GitHub just said it exists. Caching
        // an absence here hides a badge for something demonstrably present.
        val resolver = resolver(
            view = { missing() },
            list = { ok("""[{"headRefOid":"$SHA","number":"not-a-number"}]""") },
        )

        assertNull(resolver.resolve(path, "renamed-locally", base = "main").pr)
        calls.clear()

        assertNull(resolver.resolve(path, "renamed-locally", base = "main").pr)
        assertTrue(calls.isNotEmpty(), "an undecodable head match must not be remembered as an absence")
    }

    @Test
    fun `does not remember an absence when the head search returned a record it could not inspect`() {
        val resolver = resolver(view = { missing() }, list = { ok("""["not-an-object"]""") })

        assertNull(resolver.resolve(path, "renamed-locally", base = "main").pr)
        calls.clear()

        assertNull(resolver.resolve(path, "renamed-locally", base = "main").pr)
        assertTrue(calls.isNotEmpty(), "a record that could not be inspected might have been this head's")
    }

    @Test
    fun `still remembers an absence when the head search only matched other commits`() {
        // The counterpart: a search hit for a different head is a definite "not this one", so it must not
        // spoil the run's confidence or the cache stops working for the rows it exists for.
        val resolver = resolver(
            view = { missing() },
            list = { ok("""[{"headRefOid":"deadbeef","number":9,"state":"OPEN","isDraft":false,"url":"https://pr/9"}]""") },
        )

        assertNull(resolver.resolve(path, "renamed-locally", base = "main").pr)
        calls.clear()

        assertNull(resolver.resolve(path, "renamed-locally", base = "main").pr)
        assertEquals(emptyList(), calls, "a hit on another head is a definite answer about this one")
    }

    @Test
    fun `does not serve an absence stamped with an epoch a mutation has spent`() {
        // The invariant that makes the write/clear race unreachable: an entry is validated against the
        // epoch on the way *out*, so it does not matter whether a mutation landed before, during, or
        // after the write. This asserts that invariant end to end, with clear() landing after the
        // ladder's last gh call. It is not by itself a discriminating regression test for the race — a
        // check-then-write also passes this ordering, and the few instructions between such a check and
        // its write cannot be interleaved from a test. The guarantee here is structural: there is no
        // longer a check-then-write pair to lose.
        lateinit var resolver: PrResolver
        var armed = false
        resolver = resolver(
            view = { missing() },
            list = {
                if (armed) resolver.clear()
                ok("[]")
            },
        )

        armed = true
        assertNull(resolver.resolve(path, "renamed-locally", base = "main").pr)
        armed = false
        calls.clear()

        assertNull(resolver.resolve(path, "renamed-locally", base = "main").pr)
        assertTrue(calls.isNotEmpty(), "an entry stamped with a spent epoch must never be served")
    }

    @Test
    fun `does not remember an absence proven against a repository a mutation has since changed`() {
        // clear() cannot cancel a ladder already in flight, so a resolve that began before a PR import
        // can finish after it and re-insert the absence the import just dropped. When the import leaves
        // HEAD alone, nothing else would dislodge it for 10 minutes.
        lateinit var resolver: PrResolver
        resolver = resolver(
            view = {
                resolver.clear()
                missing()
            },
        )

        assertNull(resolver.resolve(path, "feature/x", base = "main").pr)
        calls.clear()

        assertNull(resolver.resolve(path, "feature/x", base = "main").pr)
        assertTrue(calls.isNotEmpty(), "an absence proven against a stale repository must not be kept")
    }

    @Test
    fun `re-asks when the branch changes under the same commit`() {
        // `git branch -m`, or checking out a sibling ref at the same commit, leaves HEAD alone — and a
        // branch renamed and pushed at the same commit is one of the cases the head search exists for.
        val resolver = resolver(view = { args -> if (args.contains("renamed")) pr(7, "OPEN") else missing() })

        assertNull(resolver.resolve(path, "feature/x", base = "main").pr)
        calls.clear()

        assertEquals(7, assertNotNull(resolver.resolve(path, "renamed", base = "main").pr).number)
        assertTrue(calls.isNotEmpty(), "a different branch is a different question")
    }

    @Test
    fun `forgets proven absences when a mutation could have created a pull request`() {
        val resolver = resolver(view = { missing() })

        assertNull(resolver.resolve(path, "feature/x", base = "main").pr)
        calls.clear()

        // A PR import can hand a checkout the pull request this just proved absent while leaving the
        // head commit alone, so the commit key alone would keep serving the stale absence.
        resolver.clear()

        assertNull(resolver.resolve(path, "feature/x", base = "main").pr)
        assertTrue(calls.isNotEmpty(), "an invalidated absence must be re-asked")
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
        assertEquals(listOf(listOf("pr", "view", "feature/x", "--json", PR_RICH_FIELDS)), calls)
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
            assertEquals(listOf(listOf("pr", "view", "feature/x", "--json", PR_RICH_FIELDS)), calls, "for: $state")
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
    fun `reports a timed-out review conversation lookup without a pull request`() {
        // A killed process flushes no stderr, so the rate-limit and refusal tests both miss it. Left to
        // fall through, the PR would carry the default count — "every conversation settled" — and blank a
        // badge over a query that never ran.
        val resolver = resolver(view = { pr(7, "OPEN") }, api = { CmdOut(-1, "", "", timeout = true) })

        val lookup = resolver.resolve(path, "feature/x", base = "main")

        assertEquals(GhAvailability.TIMEOUT, lookup.availability)
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
        assertEquals(listOf(listOf("pr", "view", "feature/x", "--json", PR_RICH_FIELDS)), calls)
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
        assertEquals(listOf(listOf("pr", "view", "feature/x", "--json", PR_RICH_FIELDS)), calls)
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
        gh = { at, args, ms ->
            dir = at.toString()
            calls.add(args)
            budgets.add(ms)
            when {
                args.firstOrNull() == "api" -> api(args)
                args.getOrNull(1) == "list" -> list(args)
                else -> view(args)
            }
        },
        git = { at, args ->
            dir = at.toString()
            heads.add(args)
            assertEquals(listOf("rev-parse", "HEAD"), args)
            ok(head)
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

    /** The spawn failure a checkout deleted mid-poll produces: no process, so no `gh` stderr at all. */
    private fun gone(at: String) = CmdOut(-1, "", "Cannot start a process, the working directory '$at' does not exist")

    private companion object {
        const val SHA = "1111111111111111111111111111111111111111"
        const val NODE = "PR_kwDOAbCdEf"
    }
}
