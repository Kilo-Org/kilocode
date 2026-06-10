package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Reasoning
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBHtmlPane
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.UIUtil
import java.awt.Container
import javax.swing.JPanel

@Suppress("UnstableApiUsage")
class ReasoningViewStressTest : BasePlatformTestCase() {

    fun `test streaming reasoning retains markdown body and disposes editors`() {
        val base = EditorFactory.getInstance().allEditors.size
        val view = ReasoningView(reasoning("r1", done = false, text = "intro\n\n```kotlin\n"))
        val component = view.md.component
        val scroll = scrolls(view).first()
        val editor = editors(view).single()
        val count = panel(view).componentCount
        editor.getEditor(true)

        repeat(150) { i -> view.appendDelta("val x$i = $i\n") }

        assertSame(component, view.md.component)
        assertSame(scroll, scrolls(view).first())
        assertSame(editor, editors(view).single())
        assertEquals(1, editors(view).size)
        assertTrue(htmls(view).size <= 1)
        assertEquals(count, panel(view).componentCount)

        view.update(reasoning("r1", done = true, text = view.markdown() + "```"))
        assertTrue(view.bodyVisible())
        Disposer.dispose(view)
        drainEdt()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    private fun reasoning(id: String, done: Boolean, text: String) = Reasoning(id).also {
        it.done = done
        it.content.append(text)
    }

    private fun panel(view: ReasoningView): JPanel = view.md.component as JPanel

    private fun scrolls(view: ReasoningView) = descendants(view).filterIsInstance<JBScrollPane>()

    private fun htmls(view: ReasoningView) = descendants(view).filterIsInstance<JBHtmlPane>()

    private fun editors(view: ReasoningView) = descendants(view).filterIsInstance<EditorTextField>()

    private fun descendants(root: Container): List<java.awt.Component> = root.components.flatMap { child ->
        listOf(child) + ((child as? Container)?.let(::descendants) ?: emptyList())
    }

    private fun drainEdt() {
        UIUtil.dispatchAllInvocationEvents()
    }
}
