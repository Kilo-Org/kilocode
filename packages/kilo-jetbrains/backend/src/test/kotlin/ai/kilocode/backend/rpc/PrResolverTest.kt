package ai.kilocode.backend.rpc

import ai.kilocode.rpc.dto.GhAvailability
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
        assertEquals(listOf(listOf("pr", "view", "--json", PR_FIELDS)), calls)
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
