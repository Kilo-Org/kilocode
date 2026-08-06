package ai.kilocode.client.session.ui

import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.EditorTextField
import com.intellij.ui.HyperlinkLabel
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.UIUtil
import java.awt.Component
import java.awt.Container
import javax.swing.AbstractButton

class ModifiedFilesViewTest : BasePlatformTestCase() {
    private lateinit var view: ModifiedFilesView

    override fun setUp() {
        super.setUp()
        view = ModifiedFilesView({ _, _ -> })
    }

    override fun tearDown() {
        try {
            Disposer.dispose(view)
        } finally {
            super.tearDown()
        }
    }

    fun `test view is hidden without changes and shows count after diff`() {
        assertFalse(view.isVisible)

        view.setDiffs(listOf(file("src/A.kt", 2, 1, PATCH)))

        assertTrue(view.isVisible)
        assertEquals("1 file", view.countText())
    }

    fun `test header uses edit icon`() {
        val labels = components(view).filterIsInstance<JBLabel>()

        assertTrue(labels.any { it.icon === SessionViewIcons.edit })
    }

    fun `test expand renders one link and badge per file`() {
        val opened = mutableListOf<String>()
        Disposer.dispose(view)
        view = ModifiedFilesView({ href, _ -> opened.add(href) })
        view.setDiffs(listOf(
            file("src/A.kt", 2, 0, ADD),
            file("pkg/B.kt", 1, 1, UPDATE),
        ))

        assertFalse(view.bodyCreated())

        view.toggle()

        assertTrue(view.isExpanded())
        assertTrue(view.bodyVisible())
        assertTrue(view.bodyCreated())
        assertEquals(2, components(view).filterIsInstance<DiffStatBadge>().size)

        val links = components(view).filterIsInstance<JBLabel>().filter { it.text?.contains("<u>") == true }
        assertTrue(links.any { it.text!!.contains("A.kt") && it.toolTipText == "src/A.kt" })
        assertTrue(links.any { it.text!!.contains("B.kt") && it.toolTipText == "pkg/B.kt" })
    }

    fun `test popup is available only when collapsed`() {
        view.setDiffs(listOf(file("src/A.kt", 2, 1, PATCH)))

        assertNotNull(view.headerPopup())

        view.toggle()

        assertNull(view.headerPopup())
    }

    fun `test open in diff uses changed files title`() {
        val titles = mutableListOf<String>()
        view.setDiffOpener({ _, title, _ -> titles.add(title) }, "ses", "turn")
        view.setDiffs(listOf(file("src/A.kt", 2, 1, PATCH)))

        openDiffButton().doClick()

        assertEquals("Changed files", titles.single())
    }

    fun `test large changes set shows overflow placeholder instead of editors`() {
        val fired = mutableListOf<List<DiffFileDto>>()
        view.setDiffOpener({ files, _, _ -> fired.add(files) }, "ses", "turn")
        view.setDiffs(listOf(file("src/A.kt", 2100, 0, bigPatch(2100))))

        view.toggle()

        assertTrue(view.isExpanded())
        assertTrue(components(view).filterIsInstance<EditorTextField>().isEmpty())
        components(view).filterIsInstance<HyperlinkLabel>().single().doClick()
        assertEquals(1, fired.single().size)
    }

    fun `test large changes popup defers to the diff tab`() {
        val fired = mutableListOf<List<DiffFileDto>>()
        view.setDiffOpener({ files, _, _ -> fired.add(files) }, "ses", "turn")
        view.setDiffs(listOf(file("src/A.kt", 2100, 0, bigPatch(2100))))
        val body = view.headerPopup()!!.build()

        try {
            assertTrue(components(body.component).filterIsInstance<EditorTextField>().isEmpty())
            components(body.component).filterIsInstance<HyperlinkLabel>().single().doClick()
            assertEquals(1, fired.single().size)
        } finally {
            Disposer.dispose(body.disposable)
        }
    }

    fun `test dispose releases created editors`() {
        val base = EditorFactory.getInstance().allEditors.size
        view.setDiffs(listOf(file("src/A.kt", 2, 1, PATCH)))

        repeat(20) {
            view.expand()
            view.collapse()
            view.setDiffs(listOf(file("src/A.kt", it + 1, 1, PATCH)))
        }

        Disposer.dispose(view)
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    private fun components(root: Component): List<Component> {
        val out = mutableListOf<Component>()
        fun visit(node: Component) {
            out.add(node)
            if (node is Container) node.components.forEach(::visit)
        }
        visit(root)
        return out
    }

    private fun openDiffButton(): AbstractButton = view.copyToolbar as AbstractButton

    private fun file(path: String, additions: Int, deletions: Int, patch: String) = DiffFileDto(
        file = path,
        additions = additions,
        deletions = deletions,
        patch = patch,
    )

    // A patch whose line count clears SessionUiStyle.View.Tool.DIFF_MAX_LINES so the body overflows.
    private fun bigPatch(lines: Int): String = buildString {
        append("--- a/src/A.kt\n")
        append("+++ b/src/A.kt\n")
        append("@@ -0,0 +1,").append(lines).append(" @@\n")
        repeat(lines) { append("+line").append(it).append('\n') }
    }

    private companion object {
        val PATCH = """
            diff --git a/src/A.kt b/src/A.kt
            --- a/src/A.kt
            +++ b/src/A.kt
            @@ -1,1 +1,2 @@
            -old
            +new
            +more
        """.trimIndent()

        val ADD = """
            diff --git a/src/A.kt b/src/A.kt
            --- /dev/null
            +++ b/src/A.kt
            @@ -0,0 +1,2 @@
            +one
            +two
        """.trimIndent()

        val UPDATE = """
            diff --git a/pkg/B.kt b/pkg/B.kt
            --- a/pkg/B.kt
            +++ b/pkg/B.kt
            @@ -1,1 +1,1 @@
            -before
            +after
        """.trimIndent()
    }
}
