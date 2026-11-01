package ai.kilocode.backend.repo

import ai.kilocode.rpc.dto.RepoDiscovery
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RepoInferenceTest {
    private val identity: (Path) -> Path? = { it }

    @Test
    fun `managed worktrees are never inferred as repos`() {
        val result = RepoInference.discover(
            pinned = null,
            vcsRoots = listOf(Path.of("/r/repo/.kilo/worktrees/feature")),
            contentRoots = emptyList(),
            dismissed = emptySet(),
            resolve = identity,
        )
        assertTrue(result.active.isEmpty(), "our own managed checkouts must not register as projects")
        assertTrue(result.nested.isEmpty())
    }

    @Test
    fun `the pinned project is excluded from the inferred set`() {
        val result = RepoInference.discover(
            pinned = Path.of("/r/repo"),
            vcsRoots = listOf(Path.of("/r/repo")),
            contentRoots = emptyList(),
            dismissed = emptySet(),
            resolve = identity,
        )
        assertTrue(result.active.isEmpty())
    }

    @Test
    fun `a non-git root is dropped when resolve returns null`() {
        val result = RepoInference.discover(
            pinned = null,
            vcsRoots = listOf(Path.of("/r/svn-checkout")),
            contentRoots = emptyList(),
            dismissed = emptySet(),
            resolve = { null },
        )
        assertTrue(result.active.isEmpty())
    }

    @Test
    fun `two candidate roots for one repo dedupe to one`() {
        val result = RepoInference.discover(
            pinned = null,
            vcsRoots = listOf(Path.of("/r/repo/sub-a"), Path.of("/r/repo/sub-b")),
            contentRoots = emptyList(),
            dismissed = emptySet(),
            resolve = { Path.of("/r/repo") },
        )
        assertEquals(listOf(Path.of("/r/repo")), result.active)
    }

    @Test
    fun `nested roots are split out from the top level`() {
        val parent = Path.of("/r/parent")
        val inner = Path.of("/r/parent/vendor/inner")
        val result = RepoInference.discover(null, listOf(parent, inner), emptyList(), emptySet(), identity)
        assertEquals(listOf(parent), result.active)
        assertEquals(listOf(inner), result.nested, "the caller decides whether to withhold the nested set")
    }

    @Test
    fun `a repo nested inside the pinned project is reported as nested`() {
        val result = RepoInference.discover(
            pinned = Path.of("/r/monorepo"),
            vcsRoots = listOf(Path.of("/r/monorepo/libs/submodule")),
            contentRoots = emptyList(),
            dismissed = emptySet(),
            resolve = identity,
        )
        assertTrue(result.active.isEmpty())
        assertEquals(listOf(Path.of("/r/monorepo/libs/submodule")), result.nested)
    }

    @Test
    fun `dismissed roots are dropped`() {
        val result = RepoInference.discover(
            pinned = null,
            vcsRoots = listOf(Path.of("/r/repo")),
            contentRoots = emptyList(),
            dismissed = setOf("/r/repo"),
            resolve = identity,
        )
        assertTrue(result.active.isEmpty())
    }

    @Test
    fun `discovery reports which source answered`() {
        val vcs = RepoInference.discover(null, listOf(Path.of("/r/repo")), listOf(Path.of("/r/content")), emptySet(), identity)
        assertEquals(RepoDiscovery.VCS_ROOTS, vcs.discovery)

        val content = RepoInference.discover(null, emptyList(), listOf(Path.of("/r/content")), emptySet(), identity)
        assertEquals(RepoDiscovery.CONTENT_ROOTS, content.discovery)

        val none = RepoInference.discover(null, emptyList(), emptyList(), emptySet(), identity)
        assertEquals(RepoDiscovery.NONE, none.discovery)
    }

    @Test
    fun `the cap bounds the inferred list`() {
        val roots = (0..RepoInference.CAP).map { Path.of("/r/repo-$it") }
        val result = RepoInference.discover(null, roots, emptyList(), emptySet(), identity)
        assertEquals(RepoInference.CAP, result.active.size)
        assertTrue(result.truncated)
        assertFalse(RepoInference.discover(null, roots.take(2), emptyList(), emptySet(), identity).truncated)
    }
}
