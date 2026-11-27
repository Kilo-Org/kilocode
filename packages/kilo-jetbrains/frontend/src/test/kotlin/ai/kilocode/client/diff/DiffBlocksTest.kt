package ai.kilocode.client.diff

import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.diff.contents.DocumentContent
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.diff.util.DiffUserDataKeysEx
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class DiffBlocksTest : BasePlatformTestCase() {
    fun `test diffRequest uses full sides when available`() {
        val request = diffRequest(
            project,
            DiffFileDto(
                file = "src/Main.kt",
                additions = 1,
                deletions = 1,
                patch = "@@ -1 +1 @@\n-old\n+new\n",
                status = "modified",
                before = "old\nkeep\n",
                after = "new\nkeep\n",
            ),
        ) as SimpleDiffRequest

        assertEquals("old\nkeep\n", (request.contents[0] as DocumentContent).document.text)
        assertEquals("new\nkeep\n", (request.contents[1] as DocumentContent).document.text)
        // Full content already starts at line 1, so no gutter remap is installed.
        assertNull((request.contents[0] as DocumentContent).getUserData(DiffUserDataKeysEx.LINE_NUMBER_CONVERTOR))
        assertNull((request.contents[1] as DocumentContent).getUserData(DiffUserDataKeysEx.LINE_NUMBER_CONVERTOR))
    }

    fun `test diffRequest remaps hunk fallback gutter to real file lines`() {
        val request = diffRequest(
            project,
            DiffFileDto(
                file = "src/Main.kt",
                additions = 1,
                deletions = 1,
                patch = "--- a/src/Main.kt\n+++ b/src/Main.kt\n@@ -126,3 +126,3 @@\n one\n-two\n+TWO\n three\n",
                status = "modified",
            ),
        ) as SimpleDiffRequest

        val left = (request.contents[0] as DocumentContent).getUserData(DiffUserDataKeysEx.LINE_NUMBER_CONVERTOR)!!
        val right = (request.contents[1] as DocumentContent).getUserData(DiffUserDataKeysEx.LINE_NUMBER_CONVERTOR)!!
        // Document line 0 (0-based) maps to file line 125 (0-based); the platform renders it as 126.
        assertEquals(125, left.applyAsInt(0))
        assertEquals(127, left.applyAsInt(2))
        assertEquals(125, right.applyAsInt(0))
        assertEquals(127, right.applyAsInt(2))
        // Out-of-range document lines are hidden.
        assertEquals(-1, left.applyAsInt(9))
    }
}
