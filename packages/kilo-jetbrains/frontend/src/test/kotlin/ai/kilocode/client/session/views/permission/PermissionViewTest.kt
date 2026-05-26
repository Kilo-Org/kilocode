package ai.kilocode.client.session.views.permission

import ai.kilocode.client.session.model.Permission
import ai.kilocode.client.session.model.PermissionFileDiff
import ai.kilocode.client.session.model.PermissionMeta
import ai.kilocode.client.session.model.PermissionRequestState
import ai.kilocode.client.session.views.base.BaseQuestionView
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.rpc.dto.PermissionReplyDto
import com.intellij.icons.AllIcons
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import java.awt.Container
import javax.swing.AbstractButton

@Suppress("UnstableApiUsage")
class PermissionViewTest : BasePlatformTestCase() {

    private val replies = mutableListOf<Pair<String, PermissionReplyDto>>()
    private lateinit var view: PermissionView

    override fun setUp() {
        super.setUp()
        view = PermissionView(
            reply = { id, dto -> replies.add(id to dto) },
        )
    }

    fun `test run button replies once`() {
        view.show(permission())

        view.runButtonForTest().doClick()

        assertEquals(1, replies.size)
        assertEquals("perm1", replies.single().first)
        assertEquals("once", replies.single().second.reply)
        assertFalse(view.runButtonForTest().isEnabled)
        assertFalse(view.denyButtonForTest().isEnabled)
    }

    fun `test deny button rejects`() {
        view.show(permission())

        view.denyButtonForTest().doClick()

        assertEquals(1, replies.size)
        assertEquals("perm1", replies.single().first)
        assertEquals("reject", replies.single().second.reply)
    }

    fun `test view is visible after show`() {
        view.show(permission())
        assertTrue(view.isVisible)
    }

    fun `test hideView makes invisible`() {
        view.show(permission())
        view.hideView()
        assertFalse(view.isVisible)
    }

    fun `test blank patterns show only action label with no code fragment`() {
        view.show(
            Permission(
                id = "perm2",
                sessionId = "ses",
                name = "edit",
                patterns = emptyList(),
                always = emptyList(),
                meta = PermissionMeta(),
            )
        )

        assertTrue(view.isVisible)
        val text = allText(view)
        assertTrue("Expected tool label in text, got: $text", text.contains("Edit"))
        // No code label should be added when there is no target
        assertTrue("Expected no code labels for empty patterns", view.codeLabelsForTest().isEmpty())
    }

    fun `test star-only patterns show action label with no code fragment`() {
        view.show(
            Permission(
                id = "perm3",
                sessionId = "ses",
                name = "read",
                patterns = listOf("*"),
                always = emptyList(),
                meta = PermissionMeta(),
            )
        )

        assertTrue(view.isVisible)
        val text = allText(view)
        assertTrue("Expected Read label in text, got: $text", text.contains("Read"))
        assertTrue("Expected no code labels for star-only patterns", view.codeLabelsForTest().isEmpty())
    }

    fun `test bash permission shows action and command on same row`() {
        view.show(
            Permission(
                id = "perm4",
                sessionId = "ses",
                name = "bash",
                patterns = emptyList(),
                always = emptyList(),
                meta = PermissionMeta(command = "git status --short"),
            )
        )

        val text = allText(view)
        assertTrue("Expected Shell action label in text, got: $text", text.contains("Shell"))
        assertTrue("Expected command in text, got: $text", text.contains("git status --short"))
        val labels = view.codeLabelsForTest()
        assertEquals("Expected exactly one target pane for command", 1, labels.size)
        assertTrue("Expected command in target pane, got: ${labels[0].text}", labels[0].text.contains("git status --short"))
    }

    fun `test bash permission shows only header and compact detail`() {
        view.show(
            Permission(
                id = "perm4b",
                sessionId = "ses",
                name = "bash",
                patterns = emptyList(),
                always = emptyList(),
                meta = PermissionMeta(command = "git status --short"),
                message = "Run this command?",
            )
        )

        val text = allText(view)
        assertTrue("Expected permission header, got: $text", text.contains("Permission required"))
        assertTrue("Expected command in text, got: $text", text.contains("git status --short"))
        // State message should not appear for PENDING state
        assertFalse("Should not show state message for PENDING, got: $text", text.contains("Run this command?"))
    }

    fun `test non-bash patterns show action and path as separate labels`() {
        view.show(
            Permission(
                id = "perm5",
                sessionId = "ses",
                name = "read",
                patterns = listOf("src/App.kt"),
                always = emptyList(),
                meta = PermissionMeta(),
            )
        )

        val text = allText(view)
        assertTrue("Expected 'Read' in text, got: $text", text.contains("Read"))
        assertTrue("Expected path in text, got: $text", text.containsPath("src/App.kt"))

        val labels = view.codeLabelsForTest()
        assertEquals("Expected exactly one target pane for the pattern", 1, labels.size)
        assertTrue("Expected path in target pane, got: ${labels[0].text}", labels[0].text.containsPath("src/App.kt"))
    }

    fun `test multiple patterns joined in code label`() {
        view.show(
            Permission(
                id = "perm_multi",
                sessionId = "ses",
                name = "glob",
                patterns = listOf("src/*.kt", "test/*.kt"),
                always = emptyList(),
                meta = PermissionMeta(),
            )
        )

        val labels = view.codeLabelsForTest()
        assertEquals("Expected one combined code label for multiple patterns", 1, labels.size)
        assertTrue("Expected both patterns in label, got: ${labels[0].text}", labels[0].text.contains("src/*.kt"))
        assertTrue("Expected both patterns in label, got: ${labels[0].text}", labels[0].text.contains("test/*.kt"))
    }

    fun `test diff preview renders only stat badge without duplicate file path`() {
        view.show(
            Permission(
                id = "perm6",
                sessionId = "ses",
                name = "edit",
                patterns = listOf("src/A.kt"),
                always = emptyList(),
                meta = PermissionMeta(
                    fileDiffs = listOf(
                        PermissionFileDiff(
                            file = "src/A.kt",
                            patch = "@@ -1 +1 @@\n-old\n+new",
                            additions = 1,
                            deletions = 2,
                        )
                    ),
                ),
            )
        )

        val text = allText(view)
        assertTrue("Should render target file once, got: $text", text.containsPath("src/A.kt"))
        assertEquals("Should not duplicate target file path, got: $text", 1, pathOccurrences(text, "src/A.kt"))
        // Patch markers should NOT appear — no diff content is shown
        assertFalse("Should not render patch content, got: $text", text.contains("@@"))
        assertFalse("Should not render old line, got: $text", text.contains("-old"))
        assertFalse("Should not render new line, got: $text", text.contains("+new"))

        val diffs = view.diffViewsForTest()
        assertEquals("Expected one diff view", 1, diffs.size)
        val badge = diffs[0].badgeForTest()
        assertEquals("-2", badge.removedLabelForTest().text)
        assertEquals("+1", badge.addedLabelForTest().text)
        assertNotSame("Removed and added labels should use different colors", badge.removedLabelForTest().foreground, badge.addedLabelForTest().foreground)
    }

    fun `test diff preview shows no unavailable fallback text`() {
        view.show(
            Permission(
                id = "perm_no_patch",
                sessionId = "ses",
                name = "edit",
                patterns = listOf("src/A.kt"),
                always = emptyList(),
                meta = PermissionMeta(
                    fileDiffs = listOf(
                        PermissionFileDiff(
                            file = "src/A.kt",
                            patch = null,
                            additions = 3,
                            deletions = 1,
                        )
                    ),
                ),
            )
        )

        val text = allText(view)
        assertTrue("Should render target file once, got: $text", text.containsPath("src/A.kt"))
        assertEquals("Should not duplicate target file path, got: $text", 1, pathOccurrences(text, "src/A.kt"))
        // No "unavailable" fallback text expected in new design
        assertFalse("Should not render unavailable fallback, got: $text", text.contains("unavailable"))
        val badge = view.diffViewsForTest().single().badgeForTest()
        assertEquals("-1", badge.removedLabelForTest().text)
        assertEquals("+3", badge.addedLabelForTest().text)
    }

    fun `test multiple diffs render each file separately`() {
        view.show(
            Permission(
                id = "perm_multi_diff",
                sessionId = "ses",
                name = "edit",
                patterns = listOf("src/A.kt", "src/B.kt"),
                always = emptyList(),
                meta = PermissionMeta(
                    fileDiffs = listOf(
                        PermissionFileDiff(
                            file = "src/A.kt",
                            patch = "@@ -1 +1 @@\n-a\n+b",
                            additions = 1,
                            deletions = 1,
                        ),
                        PermissionFileDiff(
                            file = "src/B.kt",
                            patch = "@@ -2 +2 @@\n-c\n+d",
                            additions = 2,
                            deletions = 3,
                        ),
                    ),
                ),
            )
        )

        val diffs = view.diffViewsForTest()
        assertEquals("Expected two diff views", 2, diffs.size)
        assertEquals("-1", diffs[0].badgeForTest().removedLabelForTest().text)
        assertEquals("+1", diffs[0].badgeForTest().addedLabelForTest().text)
        assertEquals("-3", diffs[1].badgeForTest().removedLabelForTest().text)
        assertEquals("+2", diffs[1].badgeForTest().addedLabelForTest().text)
        // Patch content should not be in text
        val text = allText(view)
        assertFalse("Should not render patch markers, got: $text", text.contains("@@"))
    }

    fun `test no rule controls rendered`() {
        view.show(
            Permission(
                id = "perm7",
                sessionId = "ses",
                name = "edit",
                patterns = listOf("*.kt"),
                always = listOf("src/**"),
                meta = PermissionMeta(rules = listOf("rule1")),
            )
        )

        val text = allText(view)
        assertFalse("Should not contain 'Manage Auto-Approve Rules'", text.contains("Manage Auto-Approve Rules"))
        // Only Run and Deny buttons — not extra rule toggle buttons
        val btns = buttons(view)
        assertEquals("Expected exactly 2 buttons (Run and Deny)", 2, btns.size)
    }

    fun `test responding state disables buttons`() {
        view.show(
            Permission(
                id = "perm8",
                sessionId = "ses",
                name = "edit",
                patterns = listOf("*.kt"),
                always = emptyList(),
                meta = PermissionMeta(),
                state = PermissionRequestState.RESPONDING,
            )
        )

        assertFalse(view.runButtonForTest().isEnabled)
        assertFalse(view.denyButtonForTest().isEnabled)
    }

    fun `test responding state shows responding message`() {
        view.show(
            Permission(
                id = "perm_responding",
                sessionId = "ses",
                name = "edit",
                patterns = listOf("*.kt"),
                always = emptyList(),
                meta = PermissionMeta(),
                state = PermissionRequestState.RESPONDING,
            )
        )

        val text = allText(view)
        assertTrue("Should show responding message, got: $text", text.contains("Sending response"))
    }

    fun `test error state shows error message`() {
        view.show(
            Permission(
                id = "perm_error",
                sessionId = "ses",
                name = "edit",
                patterns = listOf("*.kt"),
                always = emptyList(),
                meta = PermissionMeta(),
                message = "Boom",
                state = PermissionRequestState.ERROR,
            )
        )

        val text = allText(view)
        assertTrue("Should show error message, got: $text", text.contains("Boom"))
        // ERROR state should keep buttons enabled so user can retry
        assertTrue(view.runButtonForTest().isEnabled)
        assertTrue(view.denyButtonForTest().isEnabled)
    }

    fun `test error state shows fallback error text when no message`() {
        view.show(
            Permission(
                id = "perm_error_fallback",
                sessionId = "ses",
                name = "edit",
                patterns = listOf("*.kt"),
                always = emptyList(),
                meta = PermissionMeta(),
                message = null,
                state = PermissionRequestState.ERROR,
            )
        )

        val text = allText(view)
        assertTrue("Should show fallback error text, got: $text", text.contains("Failed to send"))
    }

    fun `test allow button uses bundle text and replies once`() {
        view.show(permission())

        // run button (previously "Allow") should trigger once reply
        view.runButtonForTest().doClick()

        assertEquals(1, replies.size)
        assertEquals("once", replies.single().second.reply)
    }

    fun `test deny button uses bundle text and rejects`() {
        view.show(permission())

        view.denyButtonForTest().doClick()

        assertEquals(1, replies.size)
        assertEquals("reject", replies.single().second.reply)
    }

    // ------ shared card shell ------

    fun `test view contains BaseSessionQuestionPanel after show`() {
        view.show(permission())

        val panels = findAll<BaseQuestionView>(view)
        assertTrue("Expected a BaseSessionQuestionPanel after show", panels.isNotEmpty())
    }

    fun `test permission icon is rendered in header`() {
        view.show(permission())

        val labels = findAll<JBLabel>(view)
        assertTrue(
            "Expected permission warning icon in header",
            labels.any { it.icon == AllIcons.General.Warning },
        )
    }

    // ------ button types ------

    fun `test run button uses default style key`() {
        view.show(permission())

        val btn = view.runButtonForTest()
        assertEquals(true, btn.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY))
    }

    fun `test deny button does not have default style key`() {
        view.show(permission())

        val btn = view.denyButtonForTest()
        val key = btn.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY)
        assertTrue("Deny should not be primary", key == null || key == false)
    }

    fun `test session question buttons use question surface background`() {
        view.show(permission())

        assertEquals(SessionUiStyle.View.surface(), view.runButtonForTest().background)
        assertEquals(SessionUiStyle.View.surface(), view.denyButtonForTest().background)
    }

    // ------ code labels use editor style ------

    fun `test code label uses editor font family after applyStyle`() {
        view.show(
            Permission(
                id = "perm_codefont",
                sessionId = "ses",
                name = "bash",
                patterns = emptyList(),
                always = emptyList(),
                meta = PermissionMeta(command = "git log"),
            )
        )
        val style = SessionEditorStyle.create(family = "Courier New", size = 18)
        view.applyStyle(style)

        val labels = view.codeLabelsForTest()
        assertNotNull("Should have at least one code label for command", labels.firstOrNull())
        assertEquals("Code label font family should use editor family", "Courier New", labels[0].font.name)
    }

    fun `test permission header uses headerFont not editor font family`() {
        view.show(
            Permission(
                id = "perm_font",
                sessionId = "ses",
                name = "bash",
                patterns = emptyList(),
                always = emptyList(),
                meta = PermissionMeta(command = "ls"),
            )
        )
        val style = SessionEditorStyle.create(family = "Courier New", size = 18)
        view.applyStyle(style)

        val header = view.headerFontForTest()
        assertFalse("Permission header should not use editor font family", header.name == "Courier New")
        assertTrue("Permission header should be bold", header.isBold)
        assertEquals("Permission header should equal headerFont", style.headerFont, header)
    }

    fun `test code label uses code background`() {
        view.show(
            Permission(
                id = "perm_bg",
                sessionId = "ses",
                name = "bash",
                patterns = emptyList(),
                always = emptyList(),
                meta = PermissionMeta(command = "pwd"),
            )
        )

        val labels = view.codeLabelsForTest()
        assertFalse("Expected code labels", labels.isEmpty())
        assertEquals(SessionUiStyle.View.headerHover(), labels[0].background)
    }

    private fun permission() = Permission(
        id = "perm1",
        sessionId = "ses_test",
        name = "edit",
        patterns = listOf("*.kt"),
        always = emptyList(),
        meta = PermissionMeta(),
        message = "Review file changes",
    )

    private fun buttons(root: Container): List<AbstractButton> = root.components.flatMap { comp ->
        val item = if (comp is AbstractButton) listOf(comp) else emptyList()
        if (comp is Container) item + buttons(comp) else item
    }

    private fun allText(root: Container): String = buildString {
        fun collect(c: Container) {
            for (comp in c.components) {
                if (comp is javax.swing.text.JTextComponent) append(comp.text).append(" ")
                if (comp is javax.swing.JLabel) append(comp.text).append(" ")
                if (comp is AbstractButton) append(comp.text).append(" ")
                if (comp is Container) collect(comp)
            }
        }
        collect(root)
    }

    private fun occurrences(text: String, token: String): Int {
        if (token.isEmpty()) return 0
        return text.split(token).size - 1
    }

    private fun String.containsPath(path: String) = pathOccurrences(this, path) > 0

    private fun pathOccurrences(text: String, path: String): Int = occurrences(text.replace("<wbr>", ""), path)

    private inline fun <reified T> findAll(root: Container): List<T> = findAllCls(root, T::class.java)

    private fun <T> findAllCls(root: Container, cls: Class<T>): List<T> {
        val result = mutableListOf<T>()
        if (cls.isInstance(root)) result.add(cls.cast(root))
        for (child in root.components) {
            if (cls.isInstance(child)) result.add(cls.cast(child))
            if (child is Container && child !is AbstractButton) {
                result.addAll(findAllCls(child, cls))
            }
        }
        return result
    }
}
