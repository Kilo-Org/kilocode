package ai.kilocode.backend.diff

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DiffFullReconstructTest {

    @Test
    fun `reconstructs before across multiple hunks keeping unchanged regions`() {
        // Ten-line file; two separated single-line edits. The patch only carries 3-context hunks, so
        // the unchanged gap between them must come from the working-tree content.
        val after = (1..10).joinToString("\n") { if (it == 2) "TWO" else if (it == 9) "NINE" else "l$it" } + "\n"
        val patch = buildString {
            append("--- a/f\n+++ b/f\n")
            append("@@ -1,4 +1,4 @@\n l1\n-l2\n+TWO\n l3\n l4\n")
            append("@@ -7,4 +7,4 @@\n l7\n l8\n-l9\n+NINE\n l10\n")
        }

        val before = DiffFullReconstruct.before(after, patch)

        assertEquals((1..10).joinToString("\n") { "l$it" } + "\n", before)
    }

    @Test
    fun `reconstructs before for a deletion-only hunk`() {
        val after = "a\nc\n"
        val patch = "--- a/f\n+++ b/f\n@@ -1,3 +1,2 @@\n a\n-b\n c\n"

        assertEquals("a\nb\nc\n", DiffFullReconstruct.before(after, patch))
    }

    @Test
    fun `preserves files without a trailing newline`() {
        val after = "a\nB"
        val patch = "--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n\\ No newline at end of file\n"

        assertEquals("a\nb", DiffFullReconstruct.before(after, patch))
    }

    @Test
    fun `returns null when context does not match the working tree`() {
        val patch = "--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n"

        assertNull(DiffFullReconstruct.before("x\nB\n", patch))
    }

    @Test
    fun `returns null for added deleted binary and blank patches`() {
        assertNull(DiffFullReconstruct.before("hello\n", "--- /dev/null\n+++ b/f\n@@ -0,0 +1 @@\n+hello\n"))
        assertNull(DiffFullReconstruct.before("", "--- a/f\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n"))
        assertNull(DiffFullReconstruct.before("x", "Binary files a/f and b/f differ\n"))
        assertNull(DiffFullReconstruct.before("x", ""))
    }
}
