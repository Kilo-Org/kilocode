package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.session.views.tool.EditToolView
import ai.kilocode.client.session.views.tool.ReadToolView
import ai.kilocode.client.session.views.tool.ToolView
import com.intellij.openapi.diff.DiffColors
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.UIUtil
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.awt.Component
import java.awt.Container
import java.awt.event.MouseEvent

@Suppress("UnstableApiUsage")
class EditToolViewTest : BasePlatformTestCase() {

    private val views = mutableListOf<EditToolView>()

    override fun tearDown() {
        views.forEach { Disposer.dispose(it) }
        views.clear()
        super.tearDown()
    }

    fun `test edit tool shows Edit title and clickable file link`() {
        val opened = mutableListOf<String>()
        val view = track(EditToolView(tool(), openFile = { href, _ -> opened.add(href) }))
        val base: Any = view

        assertTrue(base is SecondarySessionPartView)
        assertTrue(view.labelText().contains("Edit"))
        assertTrue(view.linkVisible())
        assertEquals("App.kt", view.linkLabel())
        assertEquals("/repo/src/App.kt", view.linkHref())
        assertTrue(view.labelText().contains("App.kt"))

        view.openLink()

        assertEquals(listOf("/repo/src/App.kt"), opened)
    }

    fun `test edit link uses metadata path when input is only filename`() {
        val opened = mutableListOf<String>()
        val path = "backend/src/com/kirillk/watcher/dao/GameApi.java"
        val view = track(EditToolView(tool().also {
            it.title = "GameApi.java"
            it.input = mapOf("filePath" to "GameApi.java")
            it.metadata = mapOf("filediff" to fileDiff(1, 0, PATCH, path))
        }, openFile = { href, _ -> opened.add(href) }))

        assertEquals("GameApi.java", view.linkLabel())
        assertEquals(path, view.linkHref())

        view.openLink()

        assertEquals(listOf(path), opened)
    }

    fun `test changes tag shows additions and deletions`() {
        val view = track(EditToolView(tool()))

        assertTrue(view.badgeVisible())
        assertEquals(2 to 1, view.diffStat())
    }

    fun `test changes tag hidden without diff`() {
        val view = track(EditToolView(tool().also { it.metadata = emptyMap() }))

        assertFalse(view.badgeVisible())
        assertEquals(0 to 0, view.diffStat())
    }

    fun `test edit body renders unified diff and expands`() {
        val view = track(EditToolView(tool()))

        assertTrue(view.hasToggle())
        assertFalse(view.isExpanded())
        assertFalse(view.bodyVisible())
        assertTrue(view.markdown().contains("```patch-pure"))
        assertTrue(view.markdown().contains("+new1"))

        view.toggle()

        assertTrue(view.isExpanded())
        assertTrue(view.bodyVisible())
        assertTrue(view.bodyCreated())
        assertTrue(view.codeEditors().single().text.contains("new1"))
        assertFalse(view.codeEditors().single().text.contains("+new1"))
        assertFalse(view.codeEditors().single().text.contains("-old"))
    }

    fun `test edit body strips patch metadata headers`() {
        val patch = """
            Index: /repo/src/App.kt
            ===================================================================
            --- /repo/src/App.kt
            +++ /repo/src/App.kt
            @@ -1,2 +1,2 @@
             keep
            -old
            +new
        """.trimIndent()
        val view = track(EditToolView(tool().also { it.metadata = mapOf("filediff" to fileDiff(1, 1, patch)) }))

        assertTrue(view.markdown().contains("@@ -1,2 +1,2 @@"))
        assertTrue(view.markdown().contains("-old"))
        assertTrue(view.markdown().contains("+new"))
        assertFalse(view.markdown().contains("Index:"))
        assertFalse(view.markdown().contains("--- /repo"))
        assertFalse(view.markdown().contains("+++ /repo"))
        assertFalse(view.markdown().contains("===="))

        view.toggle()

        assertTrue(view.codeEditors().single().text.contains("old"))
        assertTrue(view.codeEditors().single().text.contains("new"))
        assertFalse(view.codeEditors().single().text.contains("-old"))
        assertFalse(view.codeEditors().single().text.contains("+new"))
    }

    fun `test edit body colors added and removed diff lines`() {
        val view = track(EditToolView(tool()))
        view.toggle()
        val editor = view.codeEditors().single().getEditor(true)!!
        val chars = editor.document.charsSequence
        val spans = editor.markupModel.allHighlighters.mapNotNull { h ->
            val key = h.textAttributesKey ?: return@mapNotNull null
            key to chars.subSequence(h.startOffset, h.endOffset).toString()
        }

        assertTrue(spans.any { it.first == DiffColors.DIFF_INSERTED && it.second.startsWith("new1") })
        assertTrue(spans.any { it.first == DiffColors.DIFF_DELETED && it.second.startsWith("old") })
    }

    fun `test clicking link text opens file but empty slot toggles body`() {
        val opened = mutableListOf<String>()
        val view = track(EditToolView(tool(), openFile = { href, _ -> opened.add(href) }))
        val link = linkLabel(view)
        val slot = link.parent

        click(slot, link.preferredSize.width + 50)

        assertTrue(opened.isEmpty())
        assertTrue(view.isExpanded())

        click(link, 0)

        assertEquals(listOf("/repo/src/App.kt"), opened)
    }

    fun `test collapsed hover popup shows diff and none when expanded`() {
        val view = track(EditToolView(tool()))

        assertNotNull(view.headerPopup())

        view.toggle()

        assertNull(view.headerPopup())
    }

    fun `test no hover popup without diff`() {
        val view = track(EditToolView(tool().also { it.metadata = emptyMap() }))

        assertNull(view.headerPopup())
    }

    fun `test view factory routes write tools to edit tool view`() {
        assertTrue(ViewFactory.create(tool(), openFile = { _, _ -> }) is EditToolView)
        assertTrue(ViewFactory.create(write("write"), openFile = { _, _ -> }) is EditToolView)
        assertTrue(ViewFactory.create(write("apply_patch"), openFile = { _, _ -> }) is EditToolView)
    }

    fun `test canRender matches write kind tools only`() {
        assertTrue(EditToolView.canRender(tool()))
        assertTrue(EditToolView.canRender(write("write")))
        assertFalse(EditToolView.canRender(Tool("p2", "read", toolKind("read"))))
        assertFalse(EditToolView.canRender(Tool("p3", "bash", toolKind("bash"))))
    }

    fun `test shouldReplace swaps generic and edit views`() {
        val edit = tool()
        val other = Tool("p9", "mystery", toolKind("mystery")).also { it.state = ToolExecState.COMPLETED }

        assertTrue(ViewFactory.shouldReplace(ToolView(edit), edit))
        assertTrue(ViewFactory.shouldReplace(EditToolView(edit), other))
        assertFalse(ViewFactory.shouldReplace(EditToolView(edit), edit))
    }

    fun `test edit editors are disposed after churn`() {
        val base = EditorFactory.getInstance().allEditors.size

        repeat(40) { i ->
            val view = EditToolView(tool().also { it.metadata = mapOf("diff" to patch(i)) })
            view.toggle()
            view.codeEditors().forEach { it.getEditor(true) }
            Disposer.dispose(view)
        }
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    private fun track(view: EditToolView): EditToolView {
        views.add(view)
        return view
    }

    private fun click(component: Component, x: Int) {
        component.dispatchEvent(MouseEvent(component, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, x, 1, 1, false))
    }

    private fun linkLabel(view: EditToolView): JBLabel =
        labels(view).first { it.text?.contains("<u>") == true }

    private fun labels(root: Container): List<JBLabel> = root.components.flatMap { child ->
        val nested = if (child is Container) labels(child) else emptyList()
        if (child is JBLabel) nested + child else nested
    }

    private fun tool() = Tool("p1", "edit", toolKind("edit")).also {
        it.state = ToolExecState.COMPLETED
        it.title = "src/App.kt"
        it.input = mapOf("filePath" to "/repo/src/App.kt")
        it.output = "Edit applied successfully."
        it.metadata = mapOf("filediff" to fileDiff(2, 1, PATCH))
    }

    private fun write(name: String) = Tool("p1", name, toolKind(name)).also {
        it.state = ToolExecState.COMPLETED
        it.input = mapOf("filePath" to "/repo/src/App.kt")
        it.metadata = mapOf("filediff" to fileDiff(2, 1, PATCH))
    }

    private fun patch(i: Int) = """
        --- src/App.kt
        +++ src/App.kt
        @@ -1,2 +1,2 @@
         line$i
        -old$i
        +new$i
    """.trimIndent()

    // Mirrors how the CLI serializes metadata.filediff (a JsonObject rendered to string).
    private fun fileDiff(
        additions: Int,
        deletions: Int,
        patch: String,
        path: String = "src/App.kt",
    ): String = buildJsonObject {
        put("file", path)
        put("additions", additions)
        put("deletions", deletions)
        put("patch", patch)
    }.toString()

    companion object {
        private val PATCH = """
            --- src/App.kt
            +++ src/App.kt
            @@ -1,3 +1,4 @@
             line1
            -old
            +new1
            +new2
             line3
        """.trimIndent()
    }
}
