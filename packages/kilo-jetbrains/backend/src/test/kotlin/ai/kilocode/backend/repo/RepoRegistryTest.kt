package ai.kilocode.backend.repo

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RepoRegistryTest {
    private val registry = RepoRegistry()
    private val first = "/tmp/ws-a"
    private val second = "/tmp/ws-b"

    @Test
    fun `added repos are isolated per pinned workspace root`() {
        registry.add(first, "/tmp/repo-1", "one", NOW)
        registry.add(second, "/tmp/repo-2", "two", NOW)

        assertEquals(listOf("/tmp/repo-1"), registry.added(first).map { it.root })
        assertEquals(listOf("/tmp/repo-2"), registry.added(second).map { it.root })
    }

    @Test
    fun `adding the same root twice is a no-op`() {
        assertTrue(registry.add(first, "/tmp/repo-1", null, NOW))
        assertFalse(registry.add(first, "/tmp/repo-1", "again", NOW))
        assertEquals(1, registry.added(first).size)
        assertEquals(null, registry.added(first).single().label)
    }

    @Test
    fun `order follows insertion`() {
        registry.add(first, "/tmp/a", null, NOW)
        registry.add(first, "/tmp/b", null, NOW)
        registry.add(first, "/tmp/c", null, NOW)
        assertEquals(listOf("/tmp/a", "/tmp/b", "/tmp/c"), registry.added(first).map { it.root })
    }

    @Test
    fun `remove forgets an added repo`() {
        registry.add(first, "/tmp/repo-1", null, NOW)
        assertTrue(registry.remove(first, "/tmp/repo-1"))
        assertTrue(registry.added(first).isEmpty())
        assertFalse(registry.remove(first, "/tmp/repo-1"))
    }

    @Test
    fun `a dismissed repo stays hidden and re-adding clears the dismissal`() {
        registry.dismiss(first, "/tmp/inferred")
        assertEquals(setOf("/tmp/inferred"), registry.dismissed(first))
        assertFalse(registry.dismiss(first, "/tmp/inferred"), "dismiss is idempotent")

        registry.add(first, "/tmp/inferred", null, NOW)
        assertTrue(registry.dismissed(first).isEmpty(), "an explicit add un-hides an inferred repo")
    }

    @Test
    fun `dismissals are isolated per pinned workspace root`() {
        registry.dismiss(first, "/tmp/inferred")
        assertTrue(registry.dismissed(second).isEmpty())
    }

    @Test
    fun `paths compare cross-platform`() {
        registry.add(first, "C:\\work\\repo", null, NOW)
        assertFalse(registry.add(first, "C:/work/repo/", null, NOW), "backslash vs slash and a trailing slash are the same path")
        assertEquals(1, registry.added(first).size)
    }

    private companion object {
        const val NOW = "2020-01-01T00:00:00Z"
    }
}
