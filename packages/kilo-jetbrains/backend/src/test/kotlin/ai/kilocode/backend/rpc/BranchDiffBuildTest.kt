package ai.kilocode.backend.rpc

import kotlin.test.Test
import kotlin.test.assertEquals
import ai.kilocode.rpc.dto.DiffFileDto

class BranchDiffBuildTest {
    @Test
    fun `builds ordered branch diff from git outputs`() {
        val numstat = "1\t1\tsrc/A.kt\n2\t0\tsrc/B.kt\n"
        val patch = """
            diff --git a/src/A.kt b/src/A.kt
            index 111..222 100644
            --- a/src/A.kt
            +++ b/src/A.kt
            @@ -1 +1 @@
            -old
            +new
            diff --git a/src/B.kt b/src/B.kt
            new file mode 100644
            --- /dev/null
            +++ b/src/B.kt
            @@ -0,0 +1,2 @@
            +one
            +two
        """.trimIndent()

        val diff = buildBranchDiff(numstat, patch, status = mapOf("src/A.kt" to "modified", "src/B.kt" to "added"))

        assertEquals(listOf("src/A.kt", "src/B.kt"), diff.map { it.file })
        assertEquals(1, diff[0].additions)
        assertEquals(1, diff[0].deletions)
        assertEquals(2, diff[1].additions)
        assertEquals(0, diff[1].deletions)
        assertEquals(true, diff[0].patch?.startsWith("diff --git a/src/A.kt") == true)
        assertEquals(true, diff[1].patch?.startsWith("diff --git a/src/B.kt") == true)
        assertEquals("modified", diff[0].status)
        assertEquals("added", diff[1].status)
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

    @Test
    fun `blanks patches after cap`() {
        val diff = buildBranchDiff(
            numstat = "1\t0\ta.txt\n1\t0\tb.txt\n",
            patch = """
                diff --git a/a.txt b/a.txt
                --- /dev/null
                +++ b/a.txt
                @@ -0,0 +1 @@
                +a
                diff --git a/b.txt b/b.txt
                --- /dev/null
                +++ b/b.txt
                @@ -0,0 +1 @@
                +b
            """.trimIndent(),
            cap = 20,
        )

        assertEquals("", diff[0].patch)
        assertEquals("", diff[1].patch)
    }

    @Test
    fun `appends untracked files after tracked files`() {
        val diff = buildBranchDiff(
            numstat = "1\t1\tsrc/A.kt\n",
            patch = """
                diff --git a/src/A.kt b/src/A.kt
                --- a/src/A.kt
                +++ b/src/A.kt
                @@ -1 +1 @@
                -old
                +new
            """.trimIndent(),
            untracked = listOf(DiffFileDto("src/New.kt", 2, 0, "patch", "untracked")),
        )

        assertEquals(listOf("src/A.kt", "src/New.kt"), diff.map { it.file })
        assertEquals(2, diff[1].additions)
        assertEquals("patch", diff[1].patch)
        assertEquals("untracked", diff[1].status)
    }

    @Test
    fun `untracked patches count toward cap`() {
        val diff = buildBranchDiff(
            numstat = "",
            patch = "",
            untracked = listOf(DiffFileDto("src/New.kt", 1, 0, "diff --git a/src/New.kt b/src/New.kt", "untracked")),
            cap = 5,
        )

        assertEquals("", diff.single().patch)
        assertEquals("untracked", diff.single().status)
    }
}
