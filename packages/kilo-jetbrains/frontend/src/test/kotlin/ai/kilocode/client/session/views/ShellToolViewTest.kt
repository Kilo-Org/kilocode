package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.ui.SessionSurfacePanel
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.tool.ShellToolView
import ai.kilocode.client.session.views.tool.ToolView
import com.intellij.execution.process.ProcessOutputTypes
import com.intellij.execution.ui.ConsoleViewContentType
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Container
import javax.swing.JComponent
import javax.swing.ScrollPaneConstants

@Suppress("UnstableApiUsage")
class ShellToolViewTest : BasePlatformTestCase() {
    private val views = mutableListOf<ShellToolView>()

    override fun tearDown() {
        try {
            views.forEach(Disposer::dispose)
            views.clear()
        } finally {
            super.tearDown()
        }
    }

    fun `test command only shell renders one code surface without labels`() {
        val view = track(ShellToolView(tool().also { it.input = mapOf("command" to "pwd") }))

        assertTrue(view.hasToggle())
        assertFalse(view.bodyCreated())
        assertEquals("pwd", view.bodyText())
        view.toggle()

        assertEquals("```bash\npwd\n```", view.markdown())
        assertEquals(listOf("pwd"), view.codeTexts())
        assertVisibleSurfaces(view, 1)
    }

    fun `test output only shell renders one code surface without labels`() {
        val view = track(ShellToolView(tool().also { it.output = "done" }))

        assertEquals("done", view.outputText())
        view.toggle()

        assertEquals("```shell-output\ndone\n```", view.markdown())
        assertEquals(listOf("done"), view.codeTexts())
        assertVisibleSurfaces(view, 1)
    }

    fun `test command and output render two surfaces in order`() {
        val view = track(ShellToolView(tool().also {
            it.input = mapOf("command" to "git status", "description" to "Check status")
            it.output = "clean"
        }))

        assertTrue(view.labelText().contains("Shell"))
        assertTrue(view.labelText().contains("Check status"))
        assertEquals("git status", view.commandText())
        assertEquals("clean", view.outputText())
        assertEquals("git status\n\nclean", view.bodyText())
        view.toggle()

        assertEquals("```bash\ngit status\n```\n\n```shell-output\nclean\n```", view.markdown())
        assertEquals(listOf("git status", "clean"), view.codeTexts())
        assertVisibleSurfaces(view, 2)
    }

    fun `test shell header subtitle is normalized to one html line`() {
        val view = track(ShellToolView(tool().also {
            it.input = mapOf("command" to "printf 'one\ntwo'", "description" to "Run first line\nthen second line")
            it.output = "one\ntwo"
        }))

        assertTrue(view.labelText().contains("Run first line then second line"))
        assertFalse(view.labelText().contains("\n"))
        assertTrue(view.subtitleMarkup().contains("<nobr>Run first line then second line</nobr>"))
        assertEquals("printf 'one\ntwo'\n\none\ntwo", view.bodyText())
        view.toggle()

        assertTrue(view.markdown().contains("```bash\nprintf 'one\ntwo'\n```"))
        assertTrue(view.markdown().contains("```shell-output\none\ntwo\n```"))
    }

    fun `test ansi escapes are preserved in markdown and decoded in output`() {
        val view = track(ShellToolView(tool().also { it.output = "\u001B[32mgreen\u001B[0m line" }))

        assertEquals("green line", view.outputText())
        view.toggle()

        assertTrue(view.markdown().contains("\u001B[32mgreen\u001B[0m line"))
        assertEquals(listOf("green line"), view.codeTexts())
        assertTrue(view.codeEditors().single().getEditor(true)!!.markupModel.allHighlighters.isNotEmpty())
    }

    fun `test carriage return frames keep last non-empty value`() {
        val view = track(ShellToolView(tool().also {
            it.output = "progress 1\rprogress 2\rprogress done\nstdout line\n"
        }))

        assertEquals("progress done\nstdout line\n", view.outputText())
        view.toggle()

        assertEquals(listOf("progress done\nstdout line"), view.codeTexts())
    }

    fun `test output backspaces clean visible text`() {
        val view = track(ShellToolView(tool().also { it.output = "abc\b\bd" }))

        assertEquals("ad", view.outputText())
        view.toggle()

        assertEquals(listOf("ad"), view.codeTexts())
    }

    fun `test clean output delegates terminal reducer`() {
        val view = track(ShellToolView(tool().also {
            it.output = "\u001B[31mspin 1\u001B[0m\r\u001B[32mspin 2\u001B[0m\nabc\bd\u001B[K"
        }))

        assertEquals("spin 2\nabd", view.outputText())
        assertEquals("spin 2\nabd", view.bodyText())
    }

    fun `test output backticks use longer markdown fence`() {
        val view = track(ShellToolView(tool().also { it.output = "before\n```\nafter" }))

        view.toggle()

        assertTrue(view.markdown().contains("````shell-output\nbefore\n```\nafter\n````"))
        assertEquals(listOf("before\n```\nafter"), view.codeTexts())
    }

    fun `test error renders as its own code surface`() {
        val view = track(ShellToolView(tool(ToolExecState.ERROR).also {
            it.input = mapOf("command" to "fail")
            it.error = "boom"
        }))

        assertEquals("boom", view.errorText())
        assertTrue(view.labelText().contains("Error"))
        view.toggle()

        assertEquals("```bash\nfail\n```\n\n```ansi-stderr\nboom\n```", view.markdown())
        assertEquals(listOf("fail", "boom"), view.codeTexts())
        val error = view.codeEditors().last().getEditor(true)!!
        val expected = ConsoleViewContentType.getConsoleViewType(ProcessOutputTypes.STDERR).attributesKey
        assertEquals(expected, error.markupModel.allHighlighters.single().textAttributesKey)
    }

    fun `test body is created lazily and reused`() {
        val view = track(ShellToolView(tool().also {
            it.input = mapOf("command" to "pwd")
            it.output = "/tmp"
        }))

        assertFalse(view.bodyCreated())
        assertNull(view.content())
        assertTrue(view.surfaces().isEmpty())
        assertTrue(view.codeEditors().isEmpty())
        assertTrue(view.scrolls().isEmpty())
        view.toggle()
        val body = view.content()
        val cmd = view.codeEditors().first()
        val out = view.codeEditors().last()
        view.toggle()
        view.toggle()

        assertSame(body, view.content())
        assertSame(cmd, view.codeEditors().first())
        assertSame(out, view.codeEditors().last())
        assertTrue(view.bodyVisible())
    }

    fun `test collapsed update does not create body`() {
        val view = track(ShellToolView(tool(ToolExecState.RUNNING).also {
            it.input = mapOf("command" to "pwd")
            it.output = "/tmp"
        }))

        view.update(tool().also {
            it.input = mapOf("command" to "pwd")
            it.output = "/home"
        })

        assertFalse(view.bodyCreated())
        assertEquals("pwd\n\n/home", view.bodyText())
    }

    fun `test update after first expand changes existing markdown body`() {
        val view = track(ShellToolView(tool(ToolExecState.RUNNING).also {
            it.input = mapOf("command" to "pwd")
            it.output = "/tmp"
        }))

        view.toggle()
        view.toggle()
        val body = view.content()
        val cmd = view.codeEditors().first()
        val out = view.codeEditors().last()
        view.update(tool().also {
            it.input = mapOf("command" to "pwd")
            it.output = "/home"
        })

        assertTrue(view.bodyCreated())
        assertFalse(view.bodyVisible())
        assertSame(body, view.content())
        assertSame(cmd, view.codeEditors().first())
        assertSame(out, view.codeEditors().last())
        assertEquals(listOf("pwd", "/home"), view.codeTexts())
    }

    fun `test applyStyle updates fonts in place`() {
        val view = track(ShellToolView(tool().also { it.output = "done" }))
        val style = SessionEditorStyle.create(family = "Courier New", size = 25)
        view.toggle()
        val editor = view.codeEditors().single()

        view.applyStyle(style)

        assertSame(editor, view.codeEditors().single())
        assertEquals(style.editorFont.name, view.commandFont().name)
        assertEquals(style.editorSize, view.commandFont().size)
        assertEquals(style.transcriptFont.name, view.titleFont().name)
        assertTrue(view.titleFont().isBold)
        assertEquals(style.transcriptFont.name, view.subtitleFont().name)
        assertEquals(style.transcriptFont.size, view.subtitleFont().size)
        assertFalse(view.subtitleFont().isBold)
        assertEquals(SessionUiStyle.Text.Secondary.foreground().rgb, view.subtitleForeground().rgb)
        assertTrue(view.stateFont().size < style.editorSize)
    }

    fun `test selection registers shell markdown editors`() {
        val selection = SessionSelection()
        val view = track(ShellToolView(tool().also { it.input = mapOf("command" to "pwd") }, selection))
        view.toggle()
        val editor = view.codeEditors().single().getEditor(true)
        editor?.selectionModel?.setSelection(0, 3)

        assertEquals("pwd", selection.selectedText())
        Disposer.dispose(selection)
    }

    fun `test shell view uses editor backed markdown code blocks`() {
        val style = SessionEditorStyle.current()
        val view = track(ShellToolView(tool().also { it.output = "done" }))
        view.toggle()

        assertEquals(style.editorFont.name, view.commandFont().name)
        assertEquals(1, view.codeEditors().size)
        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED, view.horizontalPolicy())
        assertTrue(view.preferredSize.height > 0)
    }

    fun `test command and output are separate rounded surfaces with a transparent footer slot`() {
        val view = track(ShellToolView(tool().also {
            it.input = mapOf("command" to "pwd")
            it.output = "/tmp"
        }))
        view.toggle()
        val surfaces = view.surfaces()

        assertEquals(2, surfaces.size)
        surfaces.forEach {
            assertTrue("each content piece is a rounded code surface", it is SessionSurfacePanel)
            assertEquals(SessionUiStyle.Colors.codeBlockBackground().rgb, it.background.rgb)
        }
        // Two independent code editors — no shared body, no "Command"/"Output" labels.
        assertEquals(2, view.codeEditors().size)
        // The footer region stays empty (and transparent) until a view adds an ambient note.
        assertFalse(view.content()!!.hasFooter())
    }

    fun `test shell code blocks are editor backed and capped to fifteen lines`() {
        val output = (1..30).joinToString("\n") { "line $it" }
        val view = track(ShellToolView(tool().also { it.output = output }))
        view.toggle()
        val pane = view.scrolls().single()
        val editor = view.codeEditors().single()
        val nested = editor.getEditor(true)!!.scrollPane
        val line = editor.getEditor(true)!!.lineHeight
        val chrome = pane.insets.top + pane.insets.bottom +
            pane.viewportBorder.getBorderInsets(pane).top + pane.viewportBorder.getBorderInsets(pane).bottom +
            pane.horizontalScrollBar.preferredSize.height

        assertEquals(output, editor.text)
        assertEquals(1, view.codeEditors().size)
        assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED, pane.verticalScrollBarPolicy)
        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED, pane.horizontalScrollBarPolicy)
        assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER, nested.verticalScrollBarPolicy)
        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, nested.horizontalScrollBarPolicy)
        assertFalse(editor.getEditor(true)!!.settings.isUseSoftWraps)
        assertTrue(pane.preferredSize.height <= line * 15 + chrome)
        assertTrue(editor.preferredSize.height > pane.preferredSize.height - chrome)
        assertTrue(pane.preferredSize.height < editor.preferredSize.height + chrome)
    }

    fun `test plain git output receives shell output highlighters`() {
        val output = """
            475ab514 (HEAD -> main, origin/main, origin/HEAD) Bump kotlinSerialization from 1.10.0 to 1.11.0
             gradle/libs.versions.toml | 2 +-
            1 file changed, 1 insertion(+), 1 deletion(-)
            e8b9785 Add second change
             packages/kilo-jetbrains/frontend/src/main/kotlin/App.kt | 14 ++++++++++----
            1 file changed, 10 insertions(+), 4 deletions(-)
        """.trimIndent()
        val display = """
            475ab514 (HEAD -> main, origin/main, origin/HEAD) Bump kotlinSerialization from 1.10.0 to 1.11.0
             gradle/libs.versions.toml | 2 +-
            1 file changed, 1 insertion(+), 1 deletion(-)
            
            e8b9785 Add second change
             packages/kilo-jetbrains/frontend/src/main/kotlin/App.kt | 14 ++++++++++----
            1 file changed, 10 insertions(+), 4 deletions(-)
        """.trimIndent()
        val view = track(ShellToolView(tool().also { it.output = output }))

        view.toggle()
        val editor = view.codeEditors().single().getEditor(true)!!

        assertTrue(view.markdown().contains("```shell-output\n$output\n```"))
        assertEquals(display, view.codeTexts().single())
        assertTrue(editor.markupModel.allHighlighters.size >= 4)
    }

    fun `test command receives shell command highlighters`() {
        val view = track(ShellToolView(tool().also {
            it.input = mapOf("command" to "git log -30 --oneline --decorate")
        }))

        view.toggle()
        val field = view.codeEditors().single()
        val editor = field.getEditor(true)!!
        val spans = editor.markupModel.allHighlighters.map {
            field.text.substring(it.startOffset, it.endOffset) to it.textAttributesKey
        }

        assertTrue(view.markdown().contains("```bash\ngit log -30 --oneline --decorate\n```"))
        assertTrue(spans.contains("git" to DefaultLanguageHighlighterColors.KEYWORD))
        assertTrue(spans.contains("-30" to DefaultLanguageHighlighterColors.KEYWORD))
        assertTrue(spans.contains("--oneline" to DefaultLanguageHighlighterColors.KEYWORD))
        assertTrue(spans.contains("--decorate" to DefaultLanguageHighlighterColors.KEYWORD))
    }

    fun `test shell header popup is available for collapsed command`() {
        val view = track(ShellToolView(tool().also {
            it.input = mapOf("command" to "pwd", "description" to "Short")
        }))

        fitSubtitle(view)
        assertNotNull(view.headerPopup())

        cropSubtitle(view)
        assertNotNull(view.headerPopup())

        view.toggle()
        assertNull(view.headerPopup())
    }

    fun `test shell header popup body uses shell command editor and splits semicolons`() {
        val base = EditorFactory.getInstance().allEditors.size
        val view = track(ShellToolView(tool().also {
            it.input = mapOf(
                "command" to "echo one; echo two; echo three",
                "description" to "A very long command description that should be cropped",
            )
        }))
        cropSubtitle(view)
        val req = view.headerPopup()!!
        val body = req.build()

        try {
            val editors = popupCodeEditors(body.component)
            editors.forEach { it.getEditor(true) }

            assertEquals(1, editors.size)
            assertEquals("echo one;\n echo two;\n echo three", editors.single().text)
            val pane = popupScrollPanes(body.component).single { it.viewport.view is com.intellij.ui.EditorTextField }
            val pad = pane.viewportBorder.getBorderInsets(pane)
            val field = editors.single()
            val border = field.border.getBorderInsets(field)
            val editor = field.getEditor(true)!!
            val lines = field.text.lines().size
            assertEquals(
                SessionUiStyle.View.Code.topPadding(),
                pad.top,
            )
            assertEquals(SessionUiStyle.View.Code.VIEWPORT_BOTTOM_PADDING, pad.bottom)
            assertEquals(SessionUiStyle.View.Code.SCROLLBAR_HEIGHT, border.top)
            assertEquals(0, border.bottom)
            assertTrue(field.preferredSize.height - border.top >= editor.lineHeight * lines)
            assertTrue(field.minimumSize.height - border.top >= editor.lineHeight * lines)
            assertTrue(pane.preferredSize.height >= field.preferredSize.height + pad.top + pad.bottom)
            assertTrue(body.component.preferredSize.width in 1..JBUI.scale(SessionUiStyle.View.Popup.WIDE_MAX_WIDTH))
            assertTrue(body.component.preferredSize.height > 0)
            assertTrue(body.component.preferredSize.height <= JBUI.scale(SessionUiStyle.View.Popup.MAX_HEIGHT))
        } finally {
            Disposer.dispose(body.disposable)
        }
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    fun `test shell header popup includes output and disposes both editors after hide`() {
        val base = EditorFactory.getInstance().allEditors.size
        val view = track(ShellToolView(tool().also {
            it.input = mapOf("command" to "git status")
            it.output = "on branch main"
        }))
        val req = view.headerPopup()!!
        val body = req.build()

        try {
            val editors = popupCodeEditors(body.component)
            editors.forEach { it.getEditor(true) }
            assertEquals(listOf("git status", "on branch main"), editors.map { it.text })
        } finally {
            Disposer.dispose(body.disposable)
        }
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    fun `test shell header popup widens to command content`() {
        val view = track(ShellToolView(tool().also {
            it.input = mapOf("command" to "echo ${"x".repeat(180)}")
        }))
        val body = view.headerPopup()!!.build()

        try {
            assertTrue(body.component.preferredSize.width > JBUI.scale(SessionUiStyle.View.Popup.MAX_WIDTH))
            assertTrue(body.component.preferredSize.width <= JBUI.scale(SessionUiStyle.View.Popup.WIDE_MAX_WIDTH))
        } finally {
            Disposer.dispose(body.disposable)
        }
    }

    fun `test shell header popup stays narrow for short command`() {
        val view = track(ShellToolView(tool().also {
            it.input = mapOf("command" to "ls")
        }))
        val body = view.headerPopup()!!.build()

        try {
            assertTrue(body.component.preferredSize.width < JBUI.scale(SessionUiStyle.View.Popup.WIDE_MAX_WIDTH))
        } finally {
            Disposer.dispose(body.disposable)
        }
    }

    fun `test shell header popup breaks chained operators outside quotes`() {
        val view = track(ShellToolView(tool().also {
            it.input = mapOf(
                "command" to "cd /x && grep -n 'a;b' f | head || echo 'no | match'",
                "description" to "A very long command description that should be cropped",
            )
        }))
        cropSubtitle(view)
        val body = view.headerPopup()!!.build()

        try {
            val editors = popupCodeEditors(body.component)
            editors.forEach { it.getEditor(true) }
            assertEquals(
                "cd /x &&\n grep -n 'a;b' f |\n head ||\n echo 'no | match'",
                editors.single().text,
            )
        } finally {
            Disposer.dispose(body.disposable)
        }
        UIUtil.dispatchAllInvocationEvents()
    }

    fun `test shell header popup editors are disposed after churn`() {
        val base = EditorFactory.getInstance().allEditors.size
        val view = track(ShellToolView(tool().also {
            it.input = mapOf("command" to "printf one; printf two", "description" to "A very long command description that should be cropped")
        }))
        cropSubtitle(view)

        repeat(20) {
            val body = view.headerPopup()!!.build()
            popupCodeEditors(body.component).forEach { it.getEditor(true) }
            Disposer.dispose(body.disposable)
        }
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    fun `test view factory routes bash and replaces generic views`() {
        val bash = tool()
        val other = Tool("p1", "mystery", toolKind("mystery")).also { it.state = ToolExecState.COMPLETED }

        assertTrue(ViewFactory.create(bash, openFile = { _, _ -> }) is ShellToolView)
        assertTrue(ViewFactory.shouldReplace(ToolView(bash), bash))
        assertTrue(ViewFactory.shouldReplace(ShellToolView(bash), other))
        assertFalse(ViewFactory.shouldReplace(ShellToolView(bash), bash))
    }

    fun `test shell editors are disposed after churn`() {
        val base = EditorFactory.getInstance().allEditors.size

        repeat(40) { i ->
            val view = ShellToolView(tool().also {
                it.input = mapOf("command" to "log $i")
                it.output = (1..20).joinToString("\n") { line -> "line $i/$line" }
            })
            view.toggle()
            view.codeEditors().forEach { it.getEditor(true) }
            Disposer.dispose(view)
        }
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    private fun ShellToolView.codeTexts() = codeEditors().map { it.text }

    private fun assertVisibleSurfaces(view: ShellToolView, expected: Int) {
        assertEquals(expected, view.surfaces().count { it.isVisible })
    }

    private fun tool(state: ToolExecState = ToolExecState.COMPLETED) = Tool("p1", "bash", toolKind("bash")).also {
        it.state = state
    }

    private fun track(view: ShellToolView): ShellToolView {
        views.add(view)
        return view
    }

    private fun layout(view: ShellToolView, width: Int) {
        view.setSize(width, view.preferredSize.height)
        layout(view)
    }

    private fun cropSubtitle(view: ShellToolView) {
        layout(view, 120)
        val label = subtitle(view)
        label.setSize(1, label.preferredSize.height)
    }

    private fun fitSubtitle(view: ShellToolView) {
        layout(view, 2000)
        val label = subtitle(view)
        label.setSize(label.preferredSize.width, label.preferredSize.height)
    }

    private fun subtitle(view: ShellToolView): JBLabel = labels(view).first { it.text == view.subtitleMarkup() }

    private fun labels(root: Container): List<JBLabel> = root.components.flatMap { child ->
        val nested = if (child is Container) labels(child) else emptyList()
        if (child is JBLabel) nested + child else nested
    }

    private fun layout(root: Container) {
        root.doLayout()
        root.components.filterIsInstance<Container>().forEach(::layout)
    }

    private fun popupCodeEditors(root: JComponent): List<com.intellij.ui.EditorTextField> {
        val found = mutableListOf<com.intellij.ui.EditorTextField>()
        fun visit(component: JComponent) {
            if (component is com.intellij.ui.EditorTextField) found.add(component)
            component.components.filterIsInstance<JComponent>().forEach(::visit)
        }
        visit(root)
        return found
    }

    private fun popupScrollPanes(root: JComponent): List<JBScrollPane> {
        val found = mutableListOf<JBScrollPane>()
        fun visit(component: JComponent) {
            if (component is JBScrollPane) found.add(component)
            component.components.filterIsInstance<JComponent>().forEach(::visit)
        }
        visit(root)
        return found
    }
}
