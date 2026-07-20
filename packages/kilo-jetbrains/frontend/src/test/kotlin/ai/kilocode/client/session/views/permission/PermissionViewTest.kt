package ai.kilocode.client.session.views.permission

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.model.Permission
import ai.kilocode.client.session.model.PermissionFileDiff
import ai.kilocode.client.session.model.PermissionMeta
import ai.kilocode.client.session.model.PermissionRequestState
import ai.kilocode.client.session.model.PermissionRuleCandidate
import ai.kilocode.client.session.model.PermissionRuleDecision
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.session.views.base.BaseQuestionView
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.md.MdCommon
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import com.intellij.icons.AllIcons
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.openapi.editor.EditorFactory
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.UIUtil
import java.awt.Container
import javax.swing.AbstractButton
import javax.swing.SwingUtilities

@Suppress("UnstableApiUsage")
class PermissionViewTest : BasePlatformTestCase() {

    private val replies = mutableListOf<Triple<String, PermissionReplyDto, PermissionAlwaysRulesDto?>>()
    private lateinit var view: PermissionView

    override fun setUp() {
        super.setUp()
        KiloPluginSettings.unsetPermissionRulesExpanded()
        view = PermissionView(
            reply = { id, dto, rules -> replies.add(Triple(id, dto, rules)) },
        )
    }

    override fun tearDown() {
        try {
            view.dispose()
            KiloPluginSettings.unsetPermissionRulesExpanded()
        } finally {
            super.tearDown()
        }
    }

    fun `test run button replies once`() {
        view.show(permission())

        view.runButtonForTest().doClick()

        assertEquals(1, replies.size)
        assertEquals("perm1", replies.single().first)
        assertEquals("once", replies.single().second.reply)
        assertNull(replies.single().third)
        assertFalse(view.runButtonForTest().isEnabled)
        assertFalse(view.denyButtonForTest().isEnabled)
    }

    fun `test deny button rejects`() {
        view.show(permission())

        view.denyButtonForTest().doClick()

        assertEquals(1, replies.size)
        assertEquals("perm1", replies.single().first)
        assertEquals("reject", replies.single().second.reply)
        assertNull(replies.single().third)
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

    fun `test bash permission shows action and command editor`() {
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
        val labels = view.codeLabelsForTest()
        assertEquals("Expected exactly one command editor", 1, labels.size)
        assertTrue("Expected command in editor, got: ${labels[0].text}", labels[0].text.contains("git status --short"))
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
        assertTrue("Expected command editor text", view.codeLabelsForTest().single().text.contains("git status --short"))
        // State message should not appear for PENDING state
        assertFalse("Should not show state message for PENDING, got: $text", text.contains("Run this command?"))
    }

    fun `test non-bash patterns show action and path in editor`() {
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

        val labels = view.codeLabelsForTest()
        assertEquals("Expected exactly one target editor for the pattern", 1, labels.size)
        assertTrue("Expected path in editor, got: ${labels[0].text}", labels[0].text.containsPath("src/App.kt"))
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
        assertTrue("Should render target file in editor", view.codeLabelsForTest().single().text.containsPath("src/A.kt"))
        assertEquals("Should render target file once in labels, got: $text", 1, pathOccurrences(text, "src/A.kt"))
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
        assertTrue("Should render target file in editor", view.codeLabelsForTest().single().text.containsPath("src/A.kt"))
        assertEquals("Should render target file once in labels, got: $text", 1, pathOccurrences(text, "src/A.kt"))
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

    fun `test rule controls render collapsed when candidates exist`() {
        view.show(
            Permission(
                id = "perm7",
                sessionId = "ses",
                name = "edit",
                patterns = listOf("*.kt"),
                always = listOf("src/**"),
                meta = PermissionMeta(
                    ruleDecisions = listOf(
                        PermissionRuleCandidate("*.kt", defaultDecision = PermissionRuleDecision.DENIED),
                        PermissionRuleCandidate("src/**", PermissionRuleDecision.APPROVED),
                    ),
                ),
            )
        )

        val text = allText(view)
        assertTrue("Should contain rules title, got: $text", text.contains("Auto-approve Rules"))
        assertFalse("Rules should be collapsed by default", view.rulesForTest().isExpanded())
        assertTrue("Rules body should be lazy", !view.rulesForTest().bodyCreatedForTest())

        view.rulesForTest().toggle()

        val approve = view.rulesForTest().approveButtonsForTest()
        val deny = view.rulesForTest().denyButtonsForTest()
        assertEquals(2, approve.size)
        assertEquals(2, deny.size)
        assertEquals(PermissionRuleDecision.PENDING, view.rulesForTest().decisionForTest("*.kt"))
        assertEquals(PermissionRuleDecision.APPROVED, view.rulesForTest().decisionForTest("src/**"))
        assertEquals("Add to allowed", approve[0].toolTipText)
        assertEquals("Remove from allowed", approve[1].toolTipText)
        assertEquals("Add to denied", deny[1].toolTipText)
        assertEquals(SessionViewIcons.chevronCollapsed.iconWidth, view.rulesForTest().bodyInsetForTest())
        val commands = view.rulesForTest().commandFieldsForTest()
        assertEquals(2, commands.size)
        assertEquals("*.kt", commands[0].text)
        assertEquals("src/**", commands[1].text)
        layoutTree(view)
        val hintY = SwingUtilities.convertPoint(view.rulesForTest().hintLabelsForTest()[0], 0, 0, view).y
        val fieldY = SwingUtilities.convertPoint(commands[0], 0, 0, view).y
        assertTrue("Rule hint should render below the controls row", hintY > fieldY)
        assertTrue(allText(view).contains("Future matching calls will use the default permission setting: Reject."))
        assertTrue(allText(view).contains("This request and future matching calls will be allowed."))
        assertEquals("Allow once", view.runButtonForTest().text)
        assertEquals("Reject", view.denyButtonForTest().text)
        assertEquals("Expected exactly 6 buttons including rule toggles", 6, buttons(view).size)
        view.runButtonForTest().doClick()
        assertNull(replies.single().third)
    }

    fun `test no rule controls render when no candidates`() {
        view.show(permission())

        val text = allText(view)
        assertFalse("Should not contain rules title, got: $text", text.contains("Auto-approve Rules"))
        assertFalse(view.rulesForTest().isVisible)
        assertEquals("Allow once", view.runButtonForTest().text)
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
        assertNull(replies.single().third)
    }

    fun `test deny button uses bundle text and rejects`() {
        view.show(permission())

        view.denyButtonForTest().doClick()

        assertEquals(1, replies.size)
        assertEquals("reject", replies.single().second.reply)
        assertNull(replies.single().third)
    }

    fun `test approved rule changes label and replies with rules`() {
        view.show(
            Permission(
                id = "perm_rules",
                sessionId = "ses",
                name = "bash",
                patterns = emptyList(),
                always = emptyList(),
                meta = PermissionMeta(
                    command = "git add .",
                    ruleDecisions = listOf(
                        PermissionRuleCandidate("git *"),
                        PermissionRuleCandidate("git add *"),
                    ),
                ),
            )
        )

        assertEquals("Allow once", view.runButtonForTest().text)
        view.rulesForTest().toggle()
        view.rulesForTest().approveButtonsForTest()[1].doClick()

        assertEquals("Allow", view.runButtonForTest().text)
        assertEquals("Reject", view.denyButtonForTest().text)
        assertTrue(view.runButtonForTest().isEnabled)
        assertFalse(view.denyButtonForTest().isEnabled)
        assertTrue(allText(view).contains("This request and future matching calls will be allowed."))
        view.runButtonForTest().doClick()

        assertEquals(1, replies.size)
        assertEquals("perm_rules", replies.single().first)
        assertEquals("once", replies.single().second.reply)
        assertEquals(listOf("git add *"), replies.single().third?.approvedAlways)
        assertEquals(emptyList<String>(), replies.single().third?.deniedAlways)
    }

    fun `test denied rule changes label and replies with denied rules`() {
        view.show(
            Permission(
                id = "perm_deny_rules",
                sessionId = "ses",
                name = "bash",
                patterns = emptyList(),
                always = emptyList(),
                meta = PermissionMeta(
                    command = "git clean -fd",
                    ruleDecisions = listOf(PermissionRuleCandidate("git clean *")),
                ),
            )
        )

        view.rulesForTest().toggle()
        view.rulesForTest().approveButtonsForTest()[0].doClick()
        assertEquals(PermissionRuleDecision.APPROVED, view.rulesForTest().decisionForTest("git clean *"))
        view.rulesForTest().denyButtonsForTest()[0].doClick()

        assertEquals(PermissionRuleDecision.DENIED, view.rulesForTest().decisionForTest("git clean *"))
        assertEquals("Allow", view.runButtonForTest().text)
        assertEquals("Reject", view.denyButtonForTest().text)
        assertFalse(view.runButtonForTest().isEnabled)
        assertTrue(view.denyButtonForTest().isEnabled)
        assertTrue(allText(view).contains("This request and future matching calls will be rejected."))
        view.denyButtonForTest().doClick()

        assertEquals("reject", replies.single().second.reply)
        assertEquals(emptyList<String>(), replies.single().third?.approvedAlways)
        assertEquals(listOf("git clean *"), replies.single().third?.deniedAlways)
    }

    fun `test reject with changed rules replies with rules`() {
        view.show(
            Permission(
                id = "perm_reject_rules",
                sessionId = "ses",
                name = "bash",
                patterns = emptyList(),
                always = emptyList(),
                meta = PermissionMeta(
                    command = "git push",
                    ruleDecisions = listOf(PermissionRuleCandidate("git push *")),
                ),
            )
        )

        view.rulesForTest().toggle()
        view.rulesForTest().denyButtonsForTest()[0].doClick()
        view.denyButtonForTest().doClick()

        assertEquals("reject", replies.single().second.reply)
        assertEquals(emptyList<String>(), replies.single().third?.approvedAlways)
        assertEquals(listOf("git push *"), replies.single().third?.deniedAlways)
    }

    fun `test active rule toggle clears back to allow once`() {
        view.show(
            Permission(
                id = "perm_clear_rules",
                sessionId = "ses",
                name = "bash",
                patterns = emptyList(),
                always = emptyList(),
                meta = PermissionMeta(
                    command = "git status",
                    ruleDecisions = listOf(PermissionRuleCandidate("git status")),
                ),
            )
        )

        view.rulesForTest().toggle()
        view.rulesForTest().approveButtonsForTest()[0].doClick()
        view.rulesForTest().approveButtonsForTest()[0].doClick()

        assertEquals(PermissionRuleDecision.PENDING, view.rulesForTest().decisionForTest("git status"))
        assertEquals("Allow once", view.runButtonForTest().text)
        view.runButtonForTest().doClick()
        assertNull(replies.single().third)
    }

    fun `test rules expansion persists for new view`() {
        view.show(
            Permission(
                id = "perm_persist_rules",
                sessionId = "ses",
                name = "bash",
                patterns = emptyList(),
                always = emptyList(),
                meta = PermissionMeta(
                    command = "pwd",
                    ruleDecisions = listOf(PermissionRuleCandidate("pwd")),
                ),
            )
        )

        view.rulesForTest().toggle()
        assertTrue(KiloPluginSettings.getPermissionRulesExpanded())

        val next = PermissionView(reply = { id, dto, rules -> replies.add(Triple(id, dto, rules)) })
        try {
            next.show(
                Permission(
                    id = "perm_persist_rules_next",
                    sessionId = "ses",
                    name = "bash",
                    patterns = emptyList(),
                    always = emptyList(),
                    meta = PermissionMeta(
                        command = "pwd",
                        ruleDecisions = listOf(PermissionRuleCandidate("pwd")),
                    ),
                )
            )
            assertTrue(next.rulesForTest().isExpanded())
            assertTrue(next.rulesForTest().bodyCreatedForTest())
        } finally {
            next.dispose()
        }
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

    fun `test permission description renders as content row`() {
        view.show(
            Permission(
                id = "perm_desc",
                sessionId = "ses",
                name = "bash",
                patterns = emptyList(),
                always = emptyList(),
                meta = PermissionMeta(
                    command = "bun test",
                    raw = mapOf("description" to "Run the targeted tests"),
                ),
            )
        )

        val areas = findAll<javax.swing.text.JTextComponent>(view).filter { it.isVisible }
        assertTrue("Expected description content row", areas.any { it.text == "Run the targeted tests" && !it.font.isBold })
        assertTrue(areas.any { it.text == "Permission required" && it.font.isBold })
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

        assertEquals(SessionUiStyle.View.Surface.bgColor(), view.runButtonForTest().background)
        assertEquals(SessionUiStyle.View.Surface.bgColor(), view.denyButtonForTest().background)
    }

    // ------ code labels use transcript style ------

    fun `test code label uses ui font family after applyStyle`() {
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
        assertEquals("Code label font family should use editor family", style.editorFont.name, labels[0].font.name)
        assertEquals(style.editorFont.size, labels[0].font.size)
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

    fun `test command editor uses markdown code block background`() {
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
        assertEquals(MdCommon.defaults(SessionEditorStyle.current()).preBg, labels[0].background)
    }

    fun `test command editor is retained and disposed`() {
        val base = EditorFactory.getInstance().allEditors.size
        view.show(
            Permission(
                id = "perm_retain",
                sessionId = "ses",
                name = "bash",
                patterns = emptyList(),
                always = emptyList(),
                meta = PermissionMeta(command = "git status"),
            )
        )
        val editor = view.codeLabelsForTest().single()
        editor.getEditor(true)
        val count = EditorFactory.getInstance().allEditors.size

        repeat(40) { i ->
            view.show(
                Permission(
                    id = "perm_retain",
                    sessionId = "ses",
                    name = "bash",
                    patterns = emptyList(),
                    always = emptyList(),
                    meta = PermissionMeta(command = "echo $i"),
                    state = if (i % 2 == 0) PermissionRequestState.PENDING else PermissionRequestState.RESPONDING,
                )
            )
            assertSame(editor, view.codeLabelsForTest().single())
            view.codeLabelsForTest().single().getEditor(true)
            assertEquals(count, EditorFactory.getInstance().allEditors.size)
        }

        view.hideView()
        UIUtil.dispatchAllInvocationEvents()

        assertTrue(view.codeLabelsForTest().isEmpty())
        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    fun `test rule command field uses editor font after applyStyle`() {
        view.show(
            Permission(
                id = "perm_rule_codefont",
                sessionId = "ses",
                name = "bash",
                patterns = emptyList(),
                always = emptyList(),
                meta = PermissionMeta(
                    command = "git log --oneline -10",
                    ruleDecisions = listOf(PermissionRuleCandidate("git log *")),
                ),
            )
        )
        val style = SessionEditorStyle.create(family = "Courier New", size = 18)
        view.applyStyle(style)
        view.rulesForTest().toggle()

        val field = view.rulesForTest().commandFieldsForTest().single()
        assertEquals("git log *", field.text)
        assertEquals(style.editorFont.name, field.font.name)
        assertEquals(style.editorFont.size, field.font.size)
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
                if (!comp.isVisible) continue
                if (comp is javax.swing.text.JTextComponent) append(comp.text).append(" ")
                if (comp is javax.swing.JLabel) append(comp.text).append(" ")
                if (comp is AbstractButton) append(comp.text).append(" ")
                if (comp is Container) collect(comp)
            }
        }
        collect(root)
    }

    private fun layoutTree(root: Container) {
        root.setSize(900, 600)
        fun layout(node: Container) {
            node.doLayout()
            for (child in node.components) {
                if (child is Container) layout(child)
            }
        }
        layout(root)
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
