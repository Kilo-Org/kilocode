package ai.kilocode.client.session.ui

import ai.kilocode.client.session.SessionUiTestBase
import ai.kilocode.client.session.ui.selection.SessionCopyTarget
import ai.kilocode.client.session.ui.selection.SessionContextMenu
import ai.kilocode.client.session.ui.selection.SessionHoverCopyOverlay
import ai.kilocode.client.session.ui.selection.SessionTargetResolver
import ai.kilocode.client.session.views.tool.ShellToolView
import ai.kilocode.client.session.views.tool.ToolView
import ai.kilocode.client.test.CopyProviderSink
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.PartDto
import com.intellij.ide.CopyProvider
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBScrollPane
import java.awt.Component
import java.awt.Container
import java.awt.Cursor
import java.awt.datatransfer.DataFlavor
import java.awt.event.MouseEvent
import java.awt.Point
import java.awt.image.BufferedImage
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.text.JTextComponent

@Suppress("UnstableApiUsage")
class SessionSelectionCopyTest : SessionUiTestBase() {
    companion object {
        private const val RGB_MASK = 0x00ffffff
    }

    fun `test transcript view exposes copy provider when selection exists`() {
        val area = showTool("alpha output")

        select(area, "alpha")
        val provider = copyProvider(area)

        assertNotNull(provider)
        assertTrue(provider!!.isCopyEnabled(DataContext.EMPTY_CONTEXT))
    }

    fun `test copy provider writes active selected text`() {
        val area = showTool("alpha output")

        select(area, "alpha")
        copyProvider(area)!!.performCopy(DataContext.EMPTY_CONTEXT)

        assertEquals("alpha", CopyPasteManager.getInstance().getContents(DataFlavor.stringFlavor))
    }

    fun `test copy provider writes full component text without selection`() {
        val area = showTool("alpha output")

        copyProvider(area)!!.performCopy(DataContext.EMPTY_CONTEXT)

        assertEquals("alpha output", CopyPasteManager.getInstance().getContents(DataFlavor.stringFlavor))
    }

    fun `test selecting another transcript component changes copied text`() {
        val one = showTool("alpha output", id = "tool_a")
        val two = showTool("bravo output", id = "tool_b")

        select(one, "alpha")
        select(two, "bravo")
        copyProvider(two)!!.performCopy(DataContext.EMPTY_CONTEXT)

        assertTrue(one.selectedText.isNullOrEmpty())
        assertEquals("bravo", CopyPasteManager.getInstance().getContents(DataFlavor.stringFlavor))
    }

    fun `test code block child context exposes session copy provider`() {
        showText("```text\nalpha code\n```")
        val field = textEditors(ui).first { it.text.contains("alpha code") }
        val editor = field.getEditor(true)!!

        editor.selectionModel.setSelection(0, 5)
        val provider = copyProvider(field as UiDataProvider)
        provider!!.performCopy(DataContext.EMPTY_CONTEXT)

        assertEquals("alpha", CopyPasteManager.getInstance().getContents(DataFlavor.stringFlavor))
    }

    fun `test code block child copies full content without selection`() {
        showText("```text\nalpha code\n```")
        val field = textEditors(ui).first { it.text.contains("alpha code") }

        copyProvider(field as UiDataProvider)!!.performCopy(DataContext.EMPTY_CONTEXT)

        assertEquals("alpha code", CopyPasteManager.getInstance().getContents(DataFlavor.stringFlavor))
    }

    fun `test session context menu resolves deepest component`() {
        val root = JPanel(null)
        val mid = JPanel(null)
        val child = JPanel(null)
        root.setBounds(0, 0, 100, 100)
        mid.setBounds(10, 10, 80, 80)
        child.setBounds(5, 5, 20, 20)
        root.add(mid)
        mid.add(child)

        assertSame(child, SessionContextMenu.target(root, root, Point(20, 20)))
    }

    fun `test hover copy resolver skips overlay and resolves underlying target`() {
        val root = JPanel(null)
        val target = TargetPanel("alpha")
        val overlay = JPanel(null)
        root.setBounds(0, 0, 100, 100)
        target.setBounds(10, 10, 80, 80)
        overlay.setBounds(15, 15, 20, 20)
        root.add(target)
        root.add(overlay)

        val item = SessionTargetResolver.copy(root, root, Point(20, 20), overlay)

        assertSame(target, item)
    }

    fun `test hover copy resolver prefers outer target for stable anchoring`() {
        val root = JPanel(null)
        val target = TargetPanel("alpha")
        val child = TargetPanel("bravo")
        root.setBounds(0, 0, 100, 100)
        target.setBounds(10, 10, 80, 80)
        child.setBounds(5, 5, 20, 20)
        root.add(target)
        target.add(child)

        val item = SessionTargetResolver.copy(root, root, Point(20, 20))

        assertSame(target, item)
    }

    fun `test code block hover copy target copies full content despite selection`() {
        showText("```text\nalpha code\n```")
        val field = textEditors(ui).first { it.text.contains("alpha code") }
        field.setSize(200, 80)
        field.getEditor(true)!!.selectionModel.setSelection(0, 5)

        val target = SessionTargetResolver.copy(field, field, Point(1, 1))

        assertNotNull(target)
        assertEquals("alpha code", target!!.copyText())
    }

    fun `test plain assistant text is not hover copy eligible`() {
        showText("plain alpha")
        val comp = textComponent("plain alpha")
        comp.setSize(200, 80)

        val target = SessionTargetResolver.copy(comp, comp, Point(1, 1))

        assertNull(target)
    }

    fun `test session ui registers hover copy overlay in overlay layer`() {
        val root = find<SessionRootPanel>(ui)
        val overlay = find<SessionHoverCopyOverlay>(ui)

        assertSame(root.overlay, overlay.parent)
        assertFalse(root.blocker.components.contains(overlay))
        assertFalse(overlay.isVisible)
        assertEquals(Cursor.HAND_CURSOR, overlay.components.single().cursor.type)
        overlay.isVisible = true
        overlay.clear()
        assertFalse(overlay.isVisible)
    }

    fun `test hover copy overlay ignores mouse events after disposal`() {
        val root = ShowingPanel()
        val parent = Disposer.newDisposable("overlay-test")
        val target = TargetPanel("alpha")
        val overlay = SessionHoverCopyOverlay(root, parent)
        root.setBounds(0, 0, 100, 100)
        target.setBounds(10, 10, 80, 80)
        root.add(target)
        root.add(overlay)

        Disposer.dispose(parent)
        target.dispatchEvent(MouseEvent(target, MouseEvent.MOUSE_MOVED, System.currentTimeMillis(), 0, 1, 1, 0, false))

        assertFalse(overlay.isVisible)
    }

    fun `test session context menu can reinstall after parent disposal`() {
        val root = JPanel(null)
        val one = Disposer.newDisposable("context-one")
        val two = Disposer.newDisposable("context-two")

        SessionContextMenu.install(root, one)
        SessionContextMenu.install(root, one)
        Disposer.dispose(one)
        SessionContextMenu.install(root, two)
        Disposer.dispose(two)
    }

    fun `test hover copy button paints opaque background before and during pointer hover`() {
        val overlay = find<SessionHoverCopyOverlay>(ui)
        val btn = overlay.components.single()
        val size = btn.preferredSize
        btn.setBounds(0, 0, size.width, size.height)

        assertEquals(rgb(UiStyle.Colors.bg()), argb(btn, 2, size.height / 2) and RGB_MASK)

        btn.dispatchEvent(MouseEvent(btn, MouseEvent.MOUSE_ENTERED, System.currentTimeMillis(), 0, 1, 1, 0, false))

        assertEquals(255, argb(btn, 2, size.height / 2) ushr 24)
    }

    private fun argb(comp: Component, x: Int, y: Int): Int {
        val size = comp.size
        val image = BufferedImage(size.width, size.height, BufferedImage.TYPE_INT_ARGB)
        val g = image.createGraphics()

        try {
            comp.paint(g)
        } finally {
            g.dispose()
        }
        return image.getRGB(x, y)
    }

    private fun rgb(color: java.awt.Color): Int = color.rgb and RGB_MASK

    fun `test hover overlay keeps current target while pointer remains inside anchor`() {
        val overlay = find<SessionHoverCopyOverlay>(ui)
        val target = TargetPanel("alpha")
        target.setBounds(10, 10, 80, 80)

        assertTrue(overlay.contains(target, target, Point(79, 1)))
        assertFalse(overlay.contains(target, target, Point(80, 1)))
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
        for (view in toolViews(ui)) expand(view)
        layout()
        return textComponent(text)
    }

    private fun showText(text: String) {
        if (controller().id == null) showMessages()
        emit(ChatEventDto.MessageUpdated("ses_test", message("msg_text")))
        emit(ChatEventDto.PartUpdated("ses_test", part("part_text", "msg_text", "text", text)))
        layout()
    }

    private fun toolViews(root: Container): List<Container> {
        val out = mutableListOf<Container>()
        if (root is ShellToolView || root is ToolView) out.add(root)
        for (child in root.components) {
            if (child is Container) out.addAll(toolViews(child))
        }
        return out
    }

    private fun expand(view: Container) = when (view) {
        is ShellToolView -> view.expand()
        is ToolView -> view.expand()
        else -> false
    }

    private fun copyProvider(provider: UiDataProvider): CopyProvider? {
        val sink = CopyProviderSink()
        provider.uiDataSnapshot(sink)
        return sink.copy
    }

    private fun copyProvider(component: Component): CopyProvider? {
        (component as? UiDataProvider)?.let(::copyProvider)?.let { return it }
        ancestors(component).filterIsInstance<UiDataProvider>().firstNotNullOfOrNull(::copyProvider)?.let { return it }
        val point = Point((component.width / 2).coerceAtLeast(0), (component.height / 2).coerceAtLeast(0))
        val target = SessionContextMenu.target(ui as JComponent, component, point) ?: component
        ancestors(target).filterIsInstance<UiDataProvider>().firstNotNullOfOrNull(::copyProvider)?.let { return it }
        return providers(ui).firstNotNullOfOrNull(::copyProvider)
    }

    private fun providers(root: Component): Sequence<UiDataProvider> = sequence {
        if (root is UiDataProvider) yield(root)
        if (root is Container) {
            for (child in root.components) yieldAll(providers(child))
        }
    }

    private fun ancestors(component: Component): Sequence<Component> = sequence {
        var comp: Component? = component
        while (comp != null) {
            yield(comp)
            comp = comp.parent
        }
    }

    private fun textEditors(root: Container): List<EditorTextField> {
        val out = mutableListOf<EditorTextField>()
        if (root is EditorTextField) out.add(root)
        for (child in root.components) {
            if (child is JBScrollPane) (child.viewport.view as? EditorTextField)?.let(out::add)
            if (child is Container) out.addAll(textEditors(child))
        }
        return out.distinct()
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

    private class TargetPanel(private val value: String) : JPanel(), SessionCopyTarget {
        override val copyAnchor: JComponent get() = this

        override fun copyText() = value
    }

    private class ShowingPanel : JPanel(null) {
        override fun isShowing() = true
    }
}
