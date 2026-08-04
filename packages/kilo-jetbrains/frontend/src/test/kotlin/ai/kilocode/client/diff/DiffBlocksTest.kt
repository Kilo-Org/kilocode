package ai.kilocode.client.diff

import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.diff.contents.DocumentContent
import com.intellij.diff.requests.SimpleDiffRequest
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
    }
}
