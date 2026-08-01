package ai.kilocode.backend.rpc

import ai.kilocode.rpc.dto.DiffFileDto
import kotlin.test.Test
import kotlin.test.assertEquals

class BranchDiffTest {
    private fun stat(path: String, status: String = "modified") = DiffFileDto(path, 1, 0, "", status)

    @Test
    fun `capDiff fills patches in order until the cap is reached`() {
        val files = listOf(stat("a.txt"), stat("b.txt"), stat("c.txt"))

        val diff = capDiff(files, cap = 5) { "12345" }

        assertEquals(listOf("a.txt", "b.txt", "c.txt"), diff.map { it.file })
        assertEquals("12345", diff[0].patch)
        assertEquals("", diff[1].patch)
        assertEquals("", diff[2].patch)
    }

    @Test
    fun `capDiff skips one oversized patch and keeps later small patches`() {
        val fetched = mutableListOf<String>()
        val files = listOf(stat("big.txt"), stat("small.txt"), stat("tiny.txt"))

        val diff = capDiff(files, cap = 4) { file ->
            fetched += file.file
            if (file.file == "big.txt") "0123456789" else "x"
        }

        assertEquals(listOf("big.txt", "small.txt", "tiny.txt"), fetched)
        assertEquals(listOf("", "x", "x"), diff.map { it.patch })
    }

    @Test
    fun `capDiff stops fetching after bounded oversized misses`() {
        val fetched = mutableListOf<String>()
        val files = listOf(stat("big1.txt"), stat("big2.txt"), stat("big3.txt"), stat("later.txt"))

        val diff = capDiff(files, cap = 4) { file ->
            fetched += file.file
            "0123456789"
        }

        assertEquals(listOf("big1.txt", "big2.txt", "big3.txt"), fetched)
        assertEquals(listOf("", "", "", ""), diff.map { it.patch })
    }

    @Test
    fun `capDiff keeps stats and skips blank patches without exhausting the budget`() {
        val fetched = mutableListOf<String>()
        val files = listOf(stat("empty.txt"), stat("kept.txt"))

        val diff = capDiff(files, cap = 10) { file ->
            fetched += file.file
            if (file.file == "empty.txt") "" else "patch"
        }

        assertEquals(listOf("empty.txt", "kept.txt"), fetched)
        assertEquals("", diff[0].patch)
        assertEquals("patch", diff[1].patch)
    }

    @Test
    fun `capDiff dispatches fetch per file so tracked and untracked share the budget`() {
        val files = listOf(stat("A.kt", "modified"), stat("New.kt", "untracked"))

        val diff = capDiff(files, cap = 100) { file ->
            if (file.status == "untracked") "untracked-patch" else "tracked-patch"
        }

        assertEquals("tracked-patch", diff[0].patch)
        assertEquals("untracked-patch", diff[1].patch)
        assertEquals("untracked", diff[1].status)
    }

    @Test
    fun `capDiff keeps all patches under a large budget`() {
        val files = (1..110).map { i -> stat("src/File$i.kt") }

        val diff = capDiff(files, cap = 8 * 1024 * 1024) { file -> "patch-${file.file}\n".repeat(30) }

        assertEquals(files.map { it.file }, diff.map { it.file })
        assertEquals(files.map { file -> "patch-${file.file}\n".repeat(30) }, diff.map { it.patch })
    }

    @Test
    fun `parses git numstat output`() {
        val stats = parseNumstat("1\t2\tsrc/A.kt\n0\t3\tsrc/B.kt\n-\t-\tbin.png\n")

        assertEquals(
            listOf(
                DiffStat("src/A.kt", 1, 2),
                DiffStat("src/B.kt", 0, 3),
                DiffStat("bin.png", 0, 0),
            ),
            stats,
        )
    }

    @Test
    fun `parses git name status output`() {
        val status = parseNameStatus("M\tsrc/A.kt\nA\tsrc/B.kt\nD\tsrc/Old.kt\n??\tsrc/Skip.kt\n")

        assertEquals(
            mapOf(
                "src/A.kt" to "modified",
                "src/B.kt" to "added",
                "src/Old.kt" to "deleted",
            ),
            status,
        )
    }
}
