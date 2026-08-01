package ai.kilocode.client.diff

import ai.kilocode.rpc.dto.DiffFileDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DiffPatchReconstructTest {
    @Test
    fun `reconstructs modified full context patch`() {
        val dto = DiffFileDto(
            file = "src/A.kt",
            additions = 1,
            deletions = 1,
            patch = """
                diff --git a/src/A.kt b/src/A.kt
                index 111..222 100644
                --- a/src/A.kt
                +++ b/src/A.kt
                @@ -1,3 +1,3 @@
                 one
                -two
                +TWO
                 three
            """.trimIndent(),
        )

        val sides = DiffPatchReconstruct.sides(dto)

        assertTrue(sides.renderable)
        assertEquals("one\ntwo\nthree", sides.before)
        assertEquals("one\nTWO\nthree", sides.after)
    }

    @Test
    fun `newline terminated full context patch stays renderable`() {
        // Real git patches end with a newline, so split('\n') yields a trailing "" that must not be
        // counted as a hunk body line. Without the edge trim this reconstructs as non-renderable and
        // falls back to the all-green raw-patch view.
        val dto = DiffFileDto(
            file = "src/A.kt",
            additions = 1,
            deletions = 1,
            patch = """
                diff --git a/src/A.kt b/src/A.kt
                index 111..222 100644
                --- a/src/A.kt
                +++ b/src/A.kt
                @@ -1,3 +1,3 @@
                 one
                -two
                +TWO
                 three
            """.trimIndent() + "\n",
        )

        val sides = DiffPatchReconstruct.sides(dto)

        assertTrue(sides.renderable)
        assertEquals("one\ntwo\nthree", sides.before)
        assertEquals("one\nTWO\nthree", sides.after)
    }

    @Test
    fun `added file has empty before side`() {
        val dto = DiffFileDto(
            file = "src/A.kt",
            additions = 2,
            deletions = 0,
            patch = """
                diff --git a/src/A.kt b/src/A.kt
                --- /dev/null
                +++ b/src/A.kt
                @@ -0,0 +1,2 @@
                +one
                +two
            """.trimIndent(),
        )

        val sides = DiffPatchReconstruct.sides(dto)

        assertEquals("", sides.before)
        assertEquals("one\ntwo", sides.after)
    }

    @Test
    fun `synthesized untracked patch renders as added file`() {
        val dto = DiffFileDto(
            file = "src/New.kt",
            additions = 2,
            deletions = 0,
            patch = """
                diff --git a/src/New.kt b/src/New.kt
                new file mode 100644
                --- /dev/null
                +++ b/src/New.kt
                @@ -0,0 +1,2 @@
                +one
                +two
                \ No newline at end of file
            """.trimIndent(),
        )

        val sides = DiffPatchReconstruct.sides(dto)

        assertTrue(DiffPatchReconstruct.added(dto.patch))
        assertEquals("", sides.before)
        assertEquals("one\ntwo", sides.after)
        assertTrue(sides.renderable)
    }

    @Test
    fun `deleted file has empty after side`() {
        val dto = DiffFileDto(
            file = "src/A.kt",
            additions = 0,
            deletions = 2,
            patch = """
                diff --git a/src/A.kt b/src/A.kt
                --- a/src/A.kt
                +++ /dev/null
                @@ -1,2 +0,0 @@
                -one
                -two
            """.trimIndent(),
        )

        val sides = DiffPatchReconstruct.sides(dto)

        assertEquals("one\ntwo", sides.before)
        assertEquals("", sides.after)
    }

    @Test
    fun `multi hunk partial context patch is not renderable`() {
        val dto = DiffFileDto(
            file = "src/A.kt",
            additions = 2,
            deletions = 2,
            patch = """
                diff --git a/src/A.kt b/src/A.kt
                --- a/src/A.kt
                +++ b/src/A.kt
                @@ -1,3 +1,3 @@
                 one
                -two
                +TWO
                @@ -20,3 +20,3 @@
                 twenty
                -x
                +X
            """.trimIndent(),
        )

        val sides = DiffPatchReconstruct.sides(dto)

        assertFalse(sides.renderable)
        assertEquals("", sides.before)
        assertEquals("", sides.after)
    }

    @Test
    fun `single hunk with mismatched header length is not renderable`() {
        // header claims 3 old / 3 new lines but the body only carries 2 of each (context elided).
        val dto = DiffFileDto(
            file = "src/A.kt",
            additions = 1,
            deletions = 1,
            patch = """
                --- a/src/A.kt
                +++ b/src/A.kt
                @@ -1,3 +1,3 @@
                -two
                +TWO
            """.trimIndent(),
        )

        assertFalse(DiffPatchReconstruct.sides(dto).renderable)
    }

    @Test
    fun `binary and blank patches are not renderable`() {
        assertFalse(DiffPatchReconstruct.sides(DiffFileDto("a.bin", 0, 0, "Binary files a/a.bin and b/a.bin differ")).renderable)
        assertFalse(DiffPatchReconstruct.sides(DiffFileDto("a.kt", 0, 0, "")).renderable)
    }
}
