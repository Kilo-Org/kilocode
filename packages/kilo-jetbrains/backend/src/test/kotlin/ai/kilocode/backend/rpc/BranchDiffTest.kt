package ai.kilocode.backend.rpc

import ai.kilocode.backend.diff.DiffStat
import ai.kilocode.backend.diff.capDiff
import ai.kilocode.backend.diff.parseNameStatus
import ai.kilocode.backend.diff.parseNumstat
import ai.kilocode.rpc.dto.DiffFileDto
import kotlin.test.Test
import kotlin.test.assertEquals

class BranchDiffTest {
    private fun stat(path: String, status: String = "modified") = DiffFileDto(path, 1, 0, "", status)

    @Test
    fun `capDiff fills patches in order until the cap is reached`() {
        val files = listOf(stat("a.txt"), stat("b.txt"), stat("c.txt"))
        val fetched = mutableListOf<String>()

        val diff = capDiff(files, cap = 5) { file, _ ->
            fetched += file.file
            file.copy(patch = "12345")
        }

        assertEquals(listOf("a.txt"), fetched)
        assertEquals(files.map { it.file }, diff.map { it.file })
        assertEquals(listOf("12345", "", ""), diff.map { it.patch })
    }

    @Test
    fun `capDiff skips one oversized patch and keeps later small patches`() {
        val fetched = mutableListOf<String>()
        val files = listOf(stat("big.txt"), stat("small.txt"), stat("tiny.txt"))

        val diff = capDiff(files, cap = 4) { file, _ ->
            fetched += file.file
            file.copy(patch = if (file.file == "big.txt") "0123456789" else "x")
        }

        assertEquals(listOf("big.txt", "small.txt", "tiny.txt"), fetched)
        assertEquals(listOf("", "x", "x"), diff.map { it.patch })
    }

    @Test
    fun `capDiff stops fetching after bounded oversized misses`() {
        val fetched = mutableListOf<String>()
        val files = listOf(stat("big1.txt"), stat("big2.txt"), stat("big3.txt"), stat("later.txt"))

        val diff = capDiff(files, cap = 4) { file, _ ->
            fetched += file.file
            file.copy(patch = "0123456789")
        }

        assertEquals(listOf("big1.txt", "big2.txt", "big3.txt"), fetched)
        assertEquals(files, diff)
    }

    @Test
    fun `capDiff keeps stats and skips blank patches without exhausting the budget`() {
        val fetched = mutableListOf<String>()
        val files = listOf(stat("empty.txt"), stat("kept.txt"))

        val diff = capDiff(files, cap = 10) { file, _ ->
            fetched += file.file
            file.copy(patch = if (file.file == "empty.txt") "" else "patch")
        }

        assertEquals(listOf("empty.txt", "kept.txt"), fetched)
        assertEquals(listOf("", "patch"), diff.map { it.patch })
    }

    @Test
    fun `capDiff dispatches fetch per file so tracked and untracked share the budget`() {
        val files = listOf(stat("A.kt", "modified"), stat("New.kt", "untracked"))

        val diff = capDiff(files, cap = 100) { file, _ ->
            file.copy(patch = if (file.status == "untracked") "untracked-patch" else "tracked-patch")
        }

        assertEquals(listOf("tracked-patch", "untracked-patch"), diff.map { it.patch })
        assertEquals("untracked", diff.last().status)
    }

    @Test
    fun `capDiff keeps all patches under a large budget`() {
        val files = (1..110).map { i -> stat("src/File$i.kt") }

        val diff = capDiff(files, cap = 8 * 1024 * 1024) { file, _ -> file.copy(patch = "patch-${file.file}\n".repeat(30)) }

        assertEquals(files.map { it.file }, diff.map { it.file })
        assertEquals(files.map { file -> "patch-${file.file}\n".repeat(30) }, diff.map { it.patch })
    }

    @Test
    fun `capDiff includes whole contents in the shared budget and preserves counts when omitted`() {
        val files = listOf(stat("rename.txt", "renamed"), stat("later.txt"))
        val budgets = mutableListOf<Int>()
        val diff = capDiff(files, 8) { file, budget ->
            budgets += budget
            file.copy(patch = "ab", before = "old", after = "new")
        }

        assertEquals(listOf(8), budgets)
        assertEquals("old", diff.first().before)
        assertEquals(files.last(), diff.last())
        assertEquals(files, capDiff(files, 7) { file, _ -> file.copy(patch = "ab", before = "old", after = "new") })
        assertEquals(files, capDiff(files, 7) { _, _ -> null })
    }

    @Test
    fun `parses NUL numstat with old and new rename paths and binary and empty entries`() {
        val stats = parseNumstat("1\t2\tsrc/A.kt\u00000\t3\tsrc/B.kt\u0000-\t-\tbin.png\u00000\t0\t\u0000old\tname\n.txt\u0000new é.txt\u00000\t0\tempty\u0000")

        assertEquals(
            listOf(
                DiffStat("src/A.kt", 1, 2),
                DiffStat("src/B.kt", 0, 3),
                DiffStat("bin.png", 0, 0, binary = true),
                DiffStat("new é.txt", 0, 0, old = "old\tname\n.txt"),
                DiffStat("empty", 0, 0),
            ),
            stats,
        )
        assertEquals(emptyList(), parseNumstat(""))
    }

    @Test
    fun `parses NUL name status without treating renamed paths as extra files`() {
        val status = parseNameStatus("M\u0000src/A.kt\u0000A\u0000src/B.kt\u0000D\u0000src/Old.kt\u0000R100\u0000old\tname\n.txt\u0000new é.txt\u0000")

        assertEquals(
            mapOf(
                "src/A.kt" to "modified",
                "src/B.kt" to "added",
                "src/Old.kt" to "deleted",
                "new é.txt" to "renamed",
            ),
            status,
        )
        assertEquals(emptyMap(), parseNameStatus(""))
    }
}
