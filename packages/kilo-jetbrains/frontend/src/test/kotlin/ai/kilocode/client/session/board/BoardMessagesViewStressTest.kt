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

    fun `test repeated updates retain message and code editor then release both on clear`() {
        val base = EditorFactory.getInstance().allEditors.size

        edt {
            view.sync(listOf(message(0)))
            val row = rows().single()
            val field = UIUtil.findComponentsOfType(row, EditorTextField::class.java).single()
            field.getEditor(true)

            repeat(150) { index ->
                view.sync(listOf(message(index)))
                assertSame(row, rows().single())
                assertSame(field, UIUtil.findComponentsOfType(row, EditorTextField::class.java).single())
                assertEquals(1, stack().componentCount)
            }

            view.sync(emptyList())
            UIUtil.dispatchAllInvocationEvents()
            assertTrue(rows().isEmpty())
            assertEquals(base, EditorFactory.getInstance().allEditors.size)
        }
    }

    private fun message(index: Int) = BoardMessageDto(
        id = "m1",
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
