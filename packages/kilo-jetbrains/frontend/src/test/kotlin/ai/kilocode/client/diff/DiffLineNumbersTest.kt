package ai.kilocode.client.diff

import ai.kilocode.client.session.views.tool.pureDiff
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class DiffLineNumbersTest : BasePlatformTestCase() {
    fun `test rows align with pure diff display lines`() {
        fixtures().forEach { patch ->
            assertEquals(pureDiff(patch).trim('\n').lines().size, DiffLineNumbers.rows(patch).size)
        }
    }

    fun `test modified hunk emits old and new counters`() {
        val patch = """
            @@ -1,3 +1,3 @@
             keep
            -old
            +new
             done
        """.trimIndent()

        assertEquals(
            listOf(
                DiffLineNumbers.Row(1, 1),
                DiffLineNumbers.Row(2, null),
                DiffLineNumbers.Row(null, 2),
                DiffLineNumbers.Row(3, 3),
            ),
            DiffLineNumbers.rows(patch),
        )
    }

    fun `test multi hunk resets counters`() {
        val patch = """
            @@ -1,1 +1,1 @@
            -old
            +new
            @@ -10,1 +20,1 @@
             keep
        """.trimIndent()

        assertEquals(
            listOf(
                DiffLineNumbers.Row(1, null),
                DiffLineNumbers.Row(null, 1),
                DiffLineNumbers.Row(10, 20),
            ),
            DiffLineNumbers.rows(patch),
        )
    }

    fun `test in-hunk header-shaped lines stay content`() {
        // A deleted "-- foo" comment renders as "--- foo" and an added "++ bar" as "+++ bar";
        // both are hunk content, so they keep incrementing the counters instead of being dropped.
        val patch = """
            --- a/q.sql
            +++ b/q.sql
            @@ -1,2 +1,2 @@
            --- old comment
            +++ new comment
             keep
        """.trimIndent()

        assertEquals(
            listOf(
                DiffLineNumbers.Row(1, null),
                DiffLineNumbers.Row(null, 1),
                DiffLineNumbers.Row(2, 2),
            ),
            DiffLineNumbers.rows(patch),
        )
    }

    fun `test no newline marker emits empty row`() {
        val patch = """
            @@ -1 +1 @@
            -old
            \ No newline at end of file
            +new
        """.trimIndent()

        assertEquals(
            listOf(
                DiffLineNumbers.Row(1, null),
                DiffLineNumbers.Row(null, null),
                DiffLineNumbers.Row(null, 1),
            ),
            DiffLineNumbers.rows(patch),
        )
    }

    private fun fixtures() = listOf(
        """
            diff --git a/src/App.kt b/src/App.kt
            index 111..222 100644
            --- a/src/App.kt
            +++ b/src/App.kt
            @@ -1,2 +1,2 @@
             keep
            -old
            +new
        """.trimIndent(),
        """
            --- /dev/null
            +++ b/src/New.kt
            @@ -0,0 +1,2 @@
            +one
            +two
        """.trimIndent(),
        """
            --- a/src/Old.kt
            +++ /dev/null
            @@ -1,2 +0,0 @@
            -one
            -two
        """.trimIndent(),
        "@@ -1 +1 @@\r\n-old\r\n+new\r\n",
        """
            --- a/q.sql
            +++ b/q.sql
            @@ -1,2 +1,2 @@
            --- old comment
            +++ new comment
             keep
        """.trimIndent(),
    )
}
