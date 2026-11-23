package ai.kilocode.client.session.board

import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.BoardMessageDto
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.EditorTextField
import com.intellij.util.ui.UIUtil

/** Retention and editor-lifecycle coverage for the stacked board Markdown surface. */
@Suppress("UnstableApiUsage")
class BoardMessagesViewStressTest : BasePlatformTestCase() {
    private lateinit var view: BoardMessagesView

    override fun setUp() {
        super.setUp()
        view = edt { BoardMessagesView(BoardAvatars(listOf("main", "ses_a"))) { _, _ -> } }
    }

    override fun tearDown() {
        try {
            if (this::view.isInitialized) edt { Disposer.dispose(view) }
        } finally {
            super.tearDown()
        }
    }

    fun `test repeated updates retain editors and subset removal releases only dropped rows`() {
        val base = EditorFactory.getInstance().allEditors.size

        edt {
            view.sync(listOf(message("m1", 0), message("m2", 0)))
            val first = rows().first()
            val second = rows().last()
            val fields = listOf(
                UIUtil.findComponentsOfType(first, EditorTextField::class.java).single(),
                UIUtil.findComponentsOfType(second, EditorTextField::class.java).single(),
            )
            val editors = fields.map { it.getEditor(true)!! }

            repeat(150) { index ->
                view.sync(listOf(message("m1", index), message("m2", index)))
                assertSame(first, rows().first())
                assertSame(second, rows().last())
                assertSame(fields.first(), UIUtil.findComponentsOfType(first, EditorTextField::class.java).single())
                assertSame(fields.last(), UIUtil.findComponentsOfType(second, EditorTextField::class.java).single())
                assertEquals(2, stack().componentCount)
            }

            view.sync(listOf(message("m2", 151)))
            UIUtil.dispatchAllInvocationEvents()
            assertEquals(listOf(second), rows())
            assertTrue(editors.first().isDisposed)
            assertFalse(editors.last().isDisposed)
            assertEquals(base + 1, EditorFactory.getInstance().allEditors.size)

            view.sync(emptyList())
            UIUtil.dispatchAllInvocationEvents()
            assertTrue(rows().isEmpty())
            assertEquals(base, EditorFactory.getInstance().allEditors.size)
        }
    }

    private fun message(id: String, index: Int) = BoardMessageDto(
        id = id,
        timestamp = index.toLong(),
        from = "ses_a",
        to = "main",
        type = "INFO",
        body = "```kotlin\nval answer = $index\n```",
    )

    private fun stack(): Stack = view.components.filterIsInstance<Stack>().single()

    private fun rows(): List<BoardMessageView> = stack().components.filterIsInstance<BoardMessageView>()

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
