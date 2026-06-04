package ai.kilocode.client.session.ui

import ai.kilocode.client.session.SessionUiTestBase
import ai.kilocode.client.session.views.ToolView
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.PartDto
import com.intellij.ide.CopyProvider
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.DataMap
import com.intellij.openapi.actionSystem.DataProvider
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.DataSnapshotProvider
import com.intellij.openapi.actionSystem.PlatformDataKeys
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.ide.CopyPasteManager
import java.awt.Container
import java.awt.datatransfer.DataFlavor
import javax.swing.text.JTextComponent

@Suppress("UnstableApiUsage")
class SessionSelectionCopyTest : SessionUiTestBase() {
    fun `test session ui exposes copy provider when selection exists`() {
        val area = showTool("alpha output")

        select(area, "alpha")
        val provider = copyProvider()

        assertNotNull(provider)
        assertTrue(provider!!.isCopyEnabled(DataContext.EMPTY_CONTEXT))
    }

    fun `test copy provider writes active selected text`() {
        val area = showTool("alpha output")

        select(area, "alpha")
        copyProvider()!!.performCopy(DataContext.EMPTY_CONTEXT)

        assertEquals("alpha", CopyPasteManager.getInstance().getContents(DataFlavor.stringFlavor))
    }

    fun `test selecting another transcript component changes copied text`() {
        val one = showTool("alpha output", id = "tool_a")
        val two = showTool("bravo output", id = "tool_b")

        select(one, "alpha")
        select(two, "bravo")
        copyProvider()!!.performCopy(DataContext.EMPTY_CONTEXT)

        assertNull(one.selectedText)
        assertEquals("bravo", CopyPasteManager.getInstance().getContents(DataFlavor.stringFlavor))
    }

    private fun select(area: JTextComponent, text: String) {
        val start = area.text.indexOf(text)
        assertTrue(start >= 0)
        area.select(start, start + text.length)
    }

    private fun showTool(text: String, id: String = "tool_msg"): JTextComponent {
        if (controller().id == null) showMessages()
        emit(ChatEventDto.MessageUpdated("ses_test", message(id)))
        emit(ChatEventDto.PartUpdated(
            "ses_test",
            PartDto(
                id = "part_$id",
                sessionID = "ses_test",
                messageID = id,
                type = "tool",
                tool = "bash",
                state = "completed",
                input = mapOf("command" to "printf"),
                output = text,
            ),
        ))
        for (view in toolViews(ui)) view.expand()
        layout()
        return textComponent(text)
    }

    private fun toolViews(root: Container): List<ToolView> {
        val out = mutableListOf<ToolView>()
        if (root is ToolView) out.add(root)
        for (child in root.components) {
            if (child is Container) out.addAll(toolViews(child))
        }
        return out
    }

    private fun copyProvider(): CopyProvider? {
        val sink = CopySink()
        (ui as UiDataProvider).uiDataSnapshot(sink)
        return sink.copy
    }

    private fun textComponent(needle: String): JTextComponent = textComponents(ui)
        .first { it.text.contains(needle) }

    private fun textComponents(root: Container): List<JTextComponent> {
        val out = mutableListOf<JTextComponent>()
        if (root is JTextComponent) out.add(root)
        for (child in root.components) {
            if (child is Container) out.addAll(textComponents(child))
        }
        return out
    }

    private class CopySink : DataSink {
        var copy: CopyProvider? = null

        override fun <T : Any> set(key: DataKey<T>, data: T?) {
            if (key == PlatformDataKeys.COPY_PROVIDER) copy = data as? CopyProvider
        }

        override fun <T : Any> setNull(key: DataKey<T>) {}

        override fun <T : Any> lazyNull(key: DataKey<T>) {}

        override fun <T : Any> lazyValue(key: DataKey<T>, data: (DataMap) -> T?) {}

        override fun uiDataSnapshot(provider: UiDataProvider) = provider.uiDataSnapshot(this)
        override fun dataSnapshot(provider: DataSnapshotProvider) = provider.dataSnapshot(this)
        override fun uiDataSnapshot(provider: DataProvider) {}
    }
}
