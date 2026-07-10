package ai.kilocode.client.session.ui

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.PromptAttachment
import ai.kilocode.client.session.ui.attachment.AttachmentCard
import ai.kilocode.client.session.ui.attachment.AttachmentCardItem
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.ui.prompt.KiloPromptCompletionProvider
import ai.kilocode.client.session.ui.prompt.MentionAction
import ai.kilocode.client.session.ui.prompt.PROMPT_ATTACHMENT_PASTE_HANDLER_KEY
import ai.kilocode.client.session.ui.prompt.PromptAttachmentPasteHandler
import ai.kilocode.client.session.ui.prompt.PromptAttachmentPasteProvider
import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.prompt.SlashAction
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.test.CopyProviderSink
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.FileSearchResultDto
import ai.kilocode.rpc.dto.PromptPartDto
import ai.kilocode.rpc.dto.WorkspaceFileDto
import com.intellij.ide.actions.UndoRedoAction
import com.intellij.icons.AllIcons
import com.intellij.codeInsight.lookup.Lookup
import com.intellij.codeInsight.lookup.LookupManager
import com.intellij.codeInsight.lookup.LookupPositionStrategy
import com.intellij.codeInsight.lookup.impl.LookupImpl
import com.intellij.notification.Notification
import com.intellij.notification.Notifications
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUiKind
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.IdeActions
import com.intellij.openapi.actionSystem.PlatformCoreDataKeys
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.command.undo.UndoManager
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.HighlighterColors
import com.intellij.openapi.editor.SpellCheckingEditorCustomizationProvider
import com.intellij.openapi.editor.actions.PasteAction
import com.intellij.openapi.editor.colors.CodeInsightColors
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.colors.EditorColorsScheme
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.editor.markup.TextAttributes
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.fileTypes.PlainTextLanguage
import com.intellij.openapi.keymap.KeymapUtil
import com.intellij.testFramework.PlatformTestUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.EditorTextField
import com.intellij.ui.EditorCustomization
import com.intellij.ui.LanguageTextField
import com.intellij.ui.components.JBLabel
import com.intellij.util.Producer
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Container
import java.awt.DefaultKeyboardFocusManager
import java.awt.Font
import java.awt.KeyboardFocusManager
import java.awt.datatransfer.DataFlavor
import java.awt.datatransfer.StringSelection
import java.awt.datatransfer.Transferable
import java.awt.event.FocusEvent
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Base64
import javax.imageio.ImageIO
import javax.swing.JButton
import javax.swing.JPanel
import javax.swing.ImageIcon
import javax.swing.ScrollPaneConstants
import javax.swing.SwingUtilities

private const val FLOATING = "com.intellij.openapi.editor.toolbar.floating.EditorFloatingToolbar"

@Suppress("UnstableApiUsage")
class PromptPanelTest : BasePlatformTestCase() {
    private val roots = mutableListOf<SessionRootPanel>()
    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeWorkspaceRpcApi
    private lateinit var workspaces: KiloWorkspaceService

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        rpc = FakeWorkspaceRpcApi()
        workspaces = KiloWorkspaceService(scope, rpc)
    }

    override fun tearDown() {
        try {
            roots.asReversed().forEach { it.removeNotify() }
            roots.clear()
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test prompt input uses transcript font settings`() {
        val style = SessionEditorStyle.current()
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val font = panel.inputFont()

        assertEquals(style.transcriptFont.name, font.name)
        assertEquals(style.transcriptFont.size, font.size)
    }

    fun `test prompt input uses editor background`() {
        val style = SessionEditorStyle.current()
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })

        assertEquals(style.editorScheme.defaultBackground, panel.defaultFocusedComponent.background)
    }

    fun `test prompt editor hides floating toolbar`() {
        val control = toolbarControl()
        realize(control, 260, 400)
        UIUtil.dispatchAllInvocationEvents()

        assertTrue(hasFloatingToolbar(control.getEditor(false)!!.component))

        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })

        realize(panel, 260, 400)
        UIUtil.dispatchAllInvocationEvents()
        val editor = (panel.defaultFocusedComponent as EditorTextField).getEditor(false)!!

        assertFalse(hasFloatingToolbar(editor.component))
    }

    fun `test prompt editor disables spellchecking`() {
        var applied: EditorEx? = null
        val provider = object : SpellCheckingEditorCustomizationProvider() {
            override fun getDisabledCustomization(): EditorCustomization {
                return EditorCustomization { ed -> applied = ed }
            }
        }
        ApplicationManager.getApplication().replaceService(
            SpellCheckingEditorCustomizationProvider::class.java,
            provider,
            testRootDisposable,
        )
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })

        realize(panel, 260, 400)
        val editor = (panel.defaultFocusedComponent as EditorTextField).getEditor(false)!!

        assertSame(editor, applied)
    }

    fun `test prompt editor horizontal insets use dedicated prompt inset`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })

        realize(panel, 260, 400)
        val editor = (panel.defaultFocusedComponent as EditorTextField).getEditor(false)!!
        val ins = editor.scrollPane.viewportBorder.getBorderInsets(editor.scrollPane)
        val pad = JBUI.scale(SessionUiStyle.View.Prompt.EDITOR_HORIZONTAL_INSET)

        assertEquals(pad, ins.left)
        assertEquals(pad, ins.right)
    }

    fun `test prompt focus outline follows editor focus`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        realize(panel, 260, 400)
        panel.setBounds(0, 0, 260, panel.preferredSize.height)
        panel.doLayout()

        val editor = (panel.defaultFocusedComponent as EditorTextField).getEditor(false)!!
        val current = KeyboardFocusManager.getCurrentKeyboardFocusManager()
        val focus = TestFocusManager()
        KeyboardFocusManager.setCurrentKeyboardFocusManager(focus)
        try {
            assertEquals(SessionUiStyle.View.Prompt.separator().rgb, paint(panel, panel.width / 2, 0).rgb)

            focus.focus(editor.contentComponent)
            editor.contentComponent.focusListeners.forEach {
                it.focusGained(FocusEvent(editor.contentComponent, FocusEvent.FOCUS_GAINED))
            }

            assertTrue(SessionUiStyle.View.Prompt.separator().rgb != paint(panel, panel.width / 2, 0).rgb)
            assertEquals(JBUI.CurrentTheme.Focus.focusColor().rgb, paint(panel, panel.width / 2, 1).rgb)
            assertEquals(JBUI.CurrentTheme.Focus.focusColor().rgb, paint(panel, 1, panel.height / 2).rgb)
            assertEquals(JBUI.CurrentTheme.Focus.focusColor().rgb, paint(panel, panel.width - 1, panel.height / 2).rgb)
        } finally {
            KeyboardFocusManager.setCurrentKeyboardFocusManager(current)
        }
    }

    fun `test applyStyle updates prompt input and height`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val style = SessionEditorStyle.create(family = "Courier New", size = 26)

        panel.applyStyle(style)

        assertEquals(style.transcriptFont.name, panel.inputFont().name)
        assertEquals(style.transcriptFont.size, panel.inputFont().size)
        assertTrue(panel.preferredSize.height >= 26)
    }

    fun `test applyStyle refreshes prompt editor chrome colors`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val bg = Color(0x21, 0x32, 0x43)
        val scheme = EditorColorsManager.getInstance().globalScheme.clone() as EditorColorsScheme
        scheme.setAttributes(
            HighlighterColors.TEXT,
            TextAttributes(Color(0xEA, 0xEA, 0xEA), bg, null, null, Font.PLAIN),
        )
        val style = SessionEditorStyle.create(scheme = scheme)

        realize(panel, 260, 400)
        val editor = (panel.defaultFocusedComponent as EditorTextField).getEditor(false)!!
        editor.scrollPane.background = Color.BLACK
        editor.scrollPane.viewport.background = Color.BLACK
        editor.contentComponent.background = Color.BLACK

        panel.applyStyle(style)

        assertEquals(bg, panel.defaultFocusedComponent.background)
        assertEquals(bg, editor.backgroundColor)
        assertEquals(bg, editor.scrollPane.background)
        assertEquals(bg, editor.scrollPane.viewport.background)
        assertEquals(bg, editor.contentComponent.background)
    }

    fun `test prompt editor grows when lines are added`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val min = editor.preferredSize.height

        realize(panel, 260, 400)
        editor.text = "one\ntwo\nthree\nfour\nfive"

        assertTrue(editor.preferredSize.height > min)
    }

    fun `test prompt editor keeps three line minimum`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val editor = panel.defaultFocusedComponent as EditorTextField

        realize(panel, 260, 400)
        val view = editor.getEditor(false)!!
        val min = view.lineHeight * SessionUiStyle.View.Prompt.EDITOR_LINES +
            JBUI.scale(SessionUiStyle.View.Prompt.EDITOR_CHROME)

        assertEquals(min, editor.preferredSize.height)
    }

    fun `test prompt editor grows when single line wraps`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val min = editor.preferredSize.height

        realize(panel, 180, 400)
        editor.text = List(80) { "wrapped" }.joinToString(" ")
        UIUtil.dispatchAllInvocationEvents()

        assertTrue(editor.preferredSize.height > min)
    }

    fun `test enhanced prompt result resizes wrapped input`() {
        var complete: ((Result<String>) -> Unit)? = null
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, done -> complete = done })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val min = editor.preferredSize.height
        panel.setReady(true)
        realize(panel, 180, 400)
        editor.text = "draft"

        enhanceButton(panel).doClick()
        complete!!(Result.success(List(80) { "enhanced" }.joinToString(" ")))
        UIUtil.dispatchAllInvocationEvents()

        assertTrue(editor.preferredSize.height > min)
    }

    fun `test empty enhance explanation resizes wrapped input`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val min = editor.preferredSize.height
        panel.setReady(true)
        realize(panel, 80, 400)

        enhanceButton(panel).doClick()
        UIUtil.dispatchAllInvocationEvents()

        assertTrue(editor.preferredSize.height > min)
        assertEquals(KiloBundle.message("prompt.action.enhance.description"), editor.text)
    }

    fun `test prompt shell height is capped by session root`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val root = realize(panel, 260, 600)

        editor.text = (1..40).joinToString("\n") { "line $it" }
        root.doLayout()
        panel.doLayout()
        UIUtil.dispatchAllInvocationEvents()

        val chrome = (panel.preferredSize.height - editor.preferredSize.height).coerceAtLeast(0)
        assertTrue(editor.preferredSize.height <= root.height / 3 - chrome + 1)
    }

    fun `test attachment strip is included in session root cap`() {
        val plain = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val attached = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        realize(plain, 260, 600)
        realize(attached, 260, 600)
        val plainEditor = plain.defaultFocusedComponent as EditorTextField
        val attachedEditor = attached.defaultFocusedComponent as EditorTextField

        plainEditor.text = (1..40).joinToString("\n") { "line $it" }
        attached.addAttachmentForTest(PromptAttachment("a", "a.txt", "text/plain", "file:///tmp/a.txt"))
        attachedEditor.text = (1..40).joinToString("\n") { "line $it" }
        UIUtil.dispatchAllInvocationEvents()

        assertTrue(attachedEditor.preferredSize.height < plainEditor.preferredSize.height)
    }

    fun `test prompt editor hides scrollbars and keeps soft wraps`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        realize(panel, 180, 400)

        val editor = (panel.defaultFocusedComponent as EditorTextField).getEditor(false)!!

        assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER, editor.scrollPane.verticalScrollBarPolicy)
        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, editor.scrollPane.horizontalScrollBarPolicy)
        assertTrue(editor.settings.isUseSoftWraps)
        assertFalse(editor.settings.isPaintSoftWraps)
        assertFalse(editor.settings.isBlockCursor)
    }

    fun `test prompt editor highlights validated commands and mentions`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> }, completion = completion())
        val field = panel.defaultFocusedComponent as EditorTextField
        rpc.fileResolver = { emptyList() }

        realize(panel, 260, 400)
        field.text = "/new use ${MentionAction.GIT_CHANGES.token} and @unknown "
        field.getEditor(false)!!.caretModel.moveToOffset(field.text.length)
        panel.refreshHighlights()
        waitForSend { spans(field).any { it.first == "@unknown" } }

        val spans = spans(field)
        assertTrue(spans.contains("/new" to DefaultLanguageHighlighterColors.KEYWORD))
        assertTrue(spans.contains(MentionAction.GIT_CHANGES.token to DefaultLanguageHighlighterColors.METADATA))
        assertTrue(spans.contains("@unknown" to CodeInsightColors.WRONG_REFERENCES_ATTRIBUTES))
    }

    fun `test prompt editor exposes file editor for undo redo`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> }, completion = completion())
        val field = panel.defaultFocusedComponent as EditorTextField

        realize(panel, 260, 400)
        val editor = field.getEditor(false)!!
        WriteCommandAction.runWriteCommandAction(project) {
            editor.document.insertString(0, "hello")
        }
        val sink = TestSink()
        (field as UiDataProvider).uiDataSnapshot(sink)
        val file = sink.file as? TextEditor ?: error("missing file editor")

        assertNotNull(file)
        assertSame(editor.document, file.editor.document)
        UndoManager.getInstance(project).undo(file)
        assertEquals("", editor.document.text)
        UndoManager.getInstance(project).redo(file)
        assertEquals("hello", editor.document.text)
    }

    fun `test prompt editor platform undo redo actions target prompt editor`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> }, completion = completion())
        val field = panel.defaultFocusedComponent as EditorTextField

        realize(panel, 260, 400)
        val editor = field.getEditor(false)!!
        WriteCommandAction.runWriteCommandAction(project) {
            editor.document.insertString(0, "hello")
        }
        assertSame(true, editor.contentComponent.getClientProperty(UndoRedoAction.IGNORE_SWING_UNDO_MANAGER))
        val sink = TestSink()
        (field as UiDataProvider).uiDataSnapshot(sink)
        val file = sink.file as? TextEditor ?: error("missing file editor")
        assertSame(editor.document, file.editor.document)
        assertTrue("prompt file editor should have undo", UndoManager.getInstance(project).isUndoAvailable(file))

        invokeAction(IdeActions.ACTION_UNDO, editor.contentComponent, file)
        assertEquals("", editor.document.text)
        invokeAction(IdeActions.ACTION_REDO, editor.contentComponent, file)
        assertEquals("hello", editor.document.text)
    }

    fun `test prompt editor component undo redo shortcuts target prompt editor`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> }, completion = completion())
        val field = panel.defaultFocusedComponent as EditorTextField

        realize(panel, 260, 400)
        val editor = field.getEditor(false)!!
        WriteCommandAction.runWriteCommandAction(project) {
            editor.document.insertString(0, "hello")
        }

        invokeComponentAction("Kilo Session Undo", editor)
        assertEquals("", editor.document.text)
        invokeComponentAction("Kilo Session Redo", editor)
        assertEquals("hello", editor.document.text)
    }

    fun `test prompt editor highlights missing mention as wrong reference`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> }, completion = completion())
        val field = panel.defaultFocusedComponent as EditorTextField
        rpc.fileResolver = { emptyList() }

        realize(panel, 260, 400)
        field.text = "@missing "
        field.getEditor(false)!!.caretModel.moveToOffset(field.text.length)
        panel.refreshHighlights()
        waitForSend { spans(field).contains("@missing" to CodeInsightColors.WRONG_REFERENCES_ATTRIBUTES) }

        assertTrue(spans(field).contains("@missing" to CodeInsightColors.WRONG_REFERENCES_ATTRIBUTES))
    }

    fun `test accepted file mention highlights immediately`() {
        rpc.searchResult = FileSearchResultDto(files = listOf(file("src/deploy.ts")))
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> }, completion = completion())
        val field = panel.defaultFocusedComponent as EditorTextField

        realize(panel, 260, 400)
        field.text = "@dep"
        val editor = field.getEditor(false)!!
        editor.caretModel.moveToOffset(field.text.length)

        invokeCompletionAction(editor)
        waitForLookupItems(editor)
        acceptLookup(editor)
        waitForSend { spans(field).contains("@src/deploy.ts" to DefaultLanguageHighlighterColors.METADATA) }

        assertTrue(spans(field).contains("@src/deploy.ts" to DefaultLanguageHighlighterColors.METADATA))
    }

    fun `test invalid edited file mention highlights after caret leaves token`() {
        rpc.searchResult = FileSearchResultDto(files = listOf(file("src/deploy.ts")))
        rpc.fileResolver = { path -> if (path == "src/deploy.ts") listOf(file(path)) else emptyList() }
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> }, completion = completion())
        val field = panel.defaultFocusedComponent as EditorTextField

        realize(panel, 260, 400)
        field.text = "@dep"
        val editor = field.getEditor(false)!!
        editor.caretModel.moveToOffset(field.text.length)
        invokeCompletionAction(editor)
        waitForLookupItems(editor)
        acceptLookup(editor)
        waitForSend { spans(field).contains("@src/deploy.ts" to DefaultLanguageHighlighterColors.METADATA) }

        val offset = field.text.indexOf(' ')
        WriteCommandAction.runWriteCommandAction(project) {
            editor.document.insertString(offset, "x")
        }
        editor.caretModel.moveToOffset(offset + 1)
        UIUtil.dispatchAllInvocationEvents()
        editor.caretModel.moveToOffset(field.text.length)
        waitForSend { spans(field).contains("@src/deploy.tsx" to CodeInsightColors.WRONG_REFERENCES_ATTRIBUTES) }

        assertTrue(spans(field).contains("@src/deploy.tsx" to CodeInsightColors.WRONG_REFERENCES_ATTRIBUTES))
    }

    fun `test prompt clear removes prompt highlighters`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> }, completion = completion())
        val field = panel.defaultFocusedComponent as EditorTextField

        realize(panel, 260, 400)
        field.text = "use ${MentionAction.GIT_CHANGES.token}"
        UIUtil.dispatchAllInvocationEvents()
        assertEquals(1, field.getEditor(false)!!.markupModel.allHighlighters.size)

        panel.clear()
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(0, field.getEditor(false)!!.markupModel.allHighlighters.size)
    }

    fun `test prompt highlighters stay bounded across edits`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> }, completion = completion())
        val field = panel.defaultFocusedComponent as EditorTextField

        realize(panel, 260, 400)
        repeat(50) {
            field.text = if (it % 2 == 0) {
                "/new ${MentionAction.GIT_CHANGES.token}"
            } else {
                "/new ${MentionAction.GIT_CHANGES.token} now"
            }
            UIUtil.dispatchAllInvocationEvents()
            assertTrue(field.getEditor(false)!!.markupModel.allHighlighters.size <= 2)
        }
    }

    fun `test prompt local completion shortcut opens mention lookup`() {
        rpc.searchResult = ai.kilocode.rpc.dto.FileSearchResultDto(
            files = listOf(ai.kilocode.rpc.dto.WorkspaceFileDto("src/deploy.ts", "deploy.ts")),
        )
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> }, completion = completion())
        val field = panel.defaultFocusedComponent as EditorTextField

        realize(panel, 260, 400)
        field.text = "@dep"
        val editor = field.getEditor(false)!!
        editor.caretModel.moveToOffset(field.text.length)

        invokeCompletionAction(editor)
        val items = waitForLookupItems(editor)

        assertTrue("items=$items", items.contains("src/deploy.ts"))
    }

    fun `test prompt local completion shortcut opens slash lookup`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> }, completion = completion())
        val field = panel.defaultFocusedComponent as EditorTextField

        realize(panel, 260, 400)
        field.text = "/ne"
        val editor = field.getEditor(false)!!
        editor.caretModel.moveToOffset(field.text.length)

        invokeCompletionAction(editor)
        val items = waitForLookupItems(editor)

        assertTrue("items=$items", items.contains("new"))
    }

    fun `test prompt completion lookup is positioned above caret`() {
        rpc.searchResult = FileSearchResultDto(
            files = listOf(WorkspaceFileDto("src/deploy.ts", "deploy.ts")),
        )
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> }, completion = completion())
        val field = panel.defaultFocusedComponent as EditorTextField

        realize(panel, 260, 400)
        field.text = "@dep"
        val editor = field.getEditor(false)!!
        editor.caretModel.moveToOffset(field.text.length)

        invokeCompletionAction(editor)
        waitForLookupItems(editor)
        val lookup = LookupManager.getActiveLookup(editor) as? LookupImpl ?: error("missing lookup")

        assertEquals(LookupPositionStrategy.ONLY_ABOVE, lookup.presentation.positionStrategy)
    }

    fun `test prompt editor shrinks when lines are removed`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val editor = panel.defaultFocusedComponent as EditorTextField

        realize(panel, 260, 400)
        val min = editor.preferredSize.height
        editor.text = "one\ntwo\nthree\nfour\nfive"
        assertTrue(editor.preferredSize.height > min)

        editor.text = "one"

        assertEquals(min, editor.preferredSize.height)
    }

    fun `test prompt editor shrinks after clear`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val editor = panel.defaultFocusedComponent as EditorTextField

        realize(panel, 260, 400)
        val min = editor.preferredSize.height
        editor.text = "one\ntwo\nthree\nfour\nfive"
        assertTrue(editor.preferredSize.height > min)

        panel.clear()

        assertEquals(min, editor.preferredSize.height)
    }

    fun `test prompt editor exposes selection copy provider`() {
        val selection = SessionSelection()
        val panel = PromptPanel(project = project, selection = selection, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val host = JPanel()
        host.add(panel)
        host.addNotify()
        try {
            editor.text = "alpha prompt"

            editor.getEditor(true)!!.selectionModel.setSelection(0, 5)
            val sink = TestSink()
            (editor as UiDataProvider).uiDataSnapshot(sink)
            sink.copy!!.performCopy(DataContext.EMPTY_CONTEXT)

            assertEquals("alpha", CopyPasteManager.getInstance().getContents(DataFlavor.stringFlavor))
        } finally {
            editor.getEditor(false)?.let(EditorFactory.getInstance()::releaseEditor)
            selection.dispose()
        }
    }

    fun `test prompt editor copies full content without selection`() {
        val selection = SessionSelection()
        val panel = PromptPanel(project = project, selection = selection, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val host = JPanel()
        host.add(panel)
        host.addNotify()
        try {
            editor.text = "alpha prompt"

            val sink = TestSink()
            (editor as UiDataProvider).uiDataSnapshot(sink)
            sink.copy!!.performCopy(DataContext.EMPTY_CONTEXT)

            assertEquals("alpha prompt", CopyPasteManager.getInstance().getContents(DataFlavor.stringFlavor))
        } finally {
            editor.getEditor(false)?.let(EditorFactory.getInstance()::releaseEditor)
            selection.dispose()
        }
    }

    fun `test attachment only prompt can send`() {
        var sent = false
        val panel = PromptPanel(project, { text, files ->
            sent = text.isBlank() && files.single().url == "file:///tmp/a.png"
        }, {}, { _, _ -> })
        panel.setReady(true)

        panel.addAttachmentForTest(PromptAttachment("a", "a.png", "image/png", "file:///tmp/a.png"))
        panel.send()
        waitForSend { sent }

        assertTrue(sent)
    }

    fun `test submit resolves mentions from current text`() {
        var text: String? = null
        var sent: List<PromptPartDto>? = null
        val part = PromptPartDto(type = "file", mime = "text/plain", url = "file:///repo/src/x.kt")
        val panel = PromptPanel(
            project = project,
            onSend = { _, files -> sent = files },
            onAbort = {},
            onEnhance = { _, _ -> },
            onMentions = { value ->
                text = value
                listOf(part)
            },
        )
        val editor = panel.defaultFocusedComponent as EditorTextField
        panel.setReady(true)

        editor.text = "read @src/x.kt"
        panel.send()
        waitForSend { sent != null }

        assertEquals("read @src/x.kt", text)
        assertEquals(listOf(part), sent)
    }

    fun `test cancelling submit mention resolution re-enables send`() {
        val entered = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        val panel = PromptPanel(
            project = project,
            onSend = { _, _ -> },
            onAbort = {},
            onEnhance = { _, _ -> },
            onMentions = {
                entered.complete(Unit)
                gate.await()
                emptyList()
            },
            cs = scope,
        )
        val editor = panel.defaultFocusedComponent as EditorTextField
        panel.setReady(true)
        editor.text = "send @file"

        panel.send()
        waitForSend { entered.isCompleted && !panel.isSendEnabled }
        scope.cancel(CancellationException("test cancellation"))
        waitForSend { panel.isSendEnabled }

        assertTrue(panel.isSendEnabled)
    }

    fun `test clear removes attachments`() {
        val panel = PromptPanel(project, { _, _ -> }, {}, { _, _ -> })

        panel.addAttachmentForTest(PromptAttachment("a", "a.txt", "text/plain", "file:///tmp/a.txt"))
        assertEquals(1, panel.attachmentCountForTest())

        panel.clear()

        assertEquals(0, panel.attachmentCountForTest())
    }

    fun `test removed attachment can be added again`() {
        val item = PromptAttachment("a", "a.txt", "text/plain", "file:///tmp/a.txt")
        val panel = PromptPanel(project, { _, _ -> }, {}, { _, _ -> })

        panel.addAttachmentForTest(item)
        attachmentRemoveButton(panel, item).doClick()
        panel.addAttachmentForTest(item)

        assertEquals(1, panel.attachmentCountForTest())
    }

    fun `test attachment card is compact icon only with tooltip metadata and hover remove`() {
        val item = PromptAttachment("a", "a.txt", "text/plain", "file:///tmp/a%20b.txt")
        val panel = PromptPanel(project, { _, _ -> }, {}, { _, _ -> })

        panel.addAttachmentForTest(item)

        val button = attachmentRemoveButton(panel, item)
        val card = attachmentCard(panel)

        assertFalse(button.isVisible)
        assertTrue(card.toolTipText.contains("a.txt"))
        assertTrue(card.toolTipText.contains("text/plain"))
        assertTrue(card.toolTipText.contains("/tmp/a b.txt"))
        assertFalse(card.toolTipText.contains("file:///"))
        assertTrue(card.toolTipText.startsWith("<html>"))
        assertTrue(card.toolTipText.contains("Name: a.txt<br>Type: text/plain<br>Location: /tmp/a b.txt"))
        assertFalse(labels(card).any { it.text == "a.txt" || it.text == "text/plain" || it.text == "/tmp/a b.txt" })
        assertTrue(components(card).filterIsInstance<javax.swing.JComponent>().any { it !== button && it.toolTipText == card.toolTipText })
        assertEquals(JBUI.scale(SessionUiStyle.View.Attachment.CARD_WIDTH), card.preferredSize.width)
        assertEquals(JBUI.scale(SessionUiStyle.View.Attachment.CARD_HEIGHT), card.preferredSize.height)
        assertEquals(0, card.getComponentZOrder(button))

        val label = labels(card).first()
        label.dispatchEvent(MouseEvent(label, MouseEvent.MOUSE_ENTERED, System.currentTimeMillis(), 0, 1, 1, 0, false))

        assertTrue(button.isVisible)
        val icon = button.icon
        button.dispatchEvent(MouseEvent(button, MouseEvent.MOUSE_ENTERED, System.currentTimeMillis(), 0, 1, 1, 0, false))
        assertNotSame(icon, button.icon)
        button.dispatchEvent(MouseEvent(button, MouseEvent.MOUSE_EXITED, System.currentTimeMillis(), 0, 1, 1, 0, false))
        assertSame(icon, button.icon)
    }

    fun `test attachment tooltip hides embedded binary content`() {
        val item = PromptAttachment("a", "a.png", "image/png", "data:image/png;base64,aGVsbG8=")
        val panel = PromptPanel(project, { _, _ -> }, {}, { _, _ -> })

        panel.addAttachmentForTest(item)

        val tip = attachmentCard(panel).toolTipText

        assertTrue(tip.contains("Name: a.png"))
        assertTrue(tip.contains("Type: image/png"))
        assertTrue(tip.contains("Location: ${KiloBundle.message("prompt.attachment.embedded")}"))
        assertFalse(tip.contains("data:image/png"))
        assertFalse(tip.contains("base64"))
        assertFalse(tip.contains("aGVsbG8="))
    }

    fun `test attachment child click opens item`() {
        var opened = false
        val card = AttachmentCard(
            AttachmentCardItem("a.txt", "text/plain", "file:///tmp/a.txt"),
            open = { opened = true },
        )

        val label = labels(card).first()
        label.dispatchEvent(MouseEvent(label, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, 1, 1, 1, false))

        assertTrue(opened)
    }

    fun `test attachment card previews embedded image data`() {
        val image = BufferedImage(2, 2, BufferedImage.TYPE_INT_ARGB)
        val out = ByteArrayOutputStream()
        ImageIO.write(image, "png", out)
        val card = AttachmentCard(
            AttachmentCardItem("a.png", "image/png", "data:image/png;base64,${Base64.getEncoder().encodeToString(out.toByteArray())}"),
        )

        card.addNotify()
        repeat(20) {
            UIUtil.dispatchAllInvocationEvents()
            if (labels(card).any { it.icon is ImageIcon }) return@repeat
            Thread.sleep(20)
        }

        assertTrue(labels(card).any { it.icon is ImageIcon })
    }

    fun `test reasoning picker hides when variants are empty`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })

        panel.reasoning.setItems(emptyList())

        assertFalse(panel.reasoning.isVisible)
    }

    fun `test reasoning picker shows selected variant`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })

        panel.reasoning.setItems(listOf(ReasoningPicker.Item("low", "Low"), ReasoningPicker.Item("high", "High")), "high")

        assertTrue(panel.reasoning.isVisible)
        assertEquals("high", panel.reasoning.selectedForTest()?.id)
        assertEquals("High ▾", panel.reasoning.text)
    }

    fun `test reasoning picker aligns unchecked rows`() {
        val picker = ReasoningPicker()
        val low = ReasoningPicker.Item("low", "Low")
        val high = ReasoningPicker.Item("high", "High")

        picker.setItems(listOf(low, high), "high")

        val icon = picker.iconForTest(low)
        assertTrue(icon is EmptyIcon)
        assertSame(AllIcons.Actions.Checked, picker.iconForTest(high))
        assertEquals(AllIcons.Actions.Checked.iconWidth, icon.iconWidth)
        assertEquals(AllIcons.Actions.Checked.iconHeight, icon.iconHeight)
    }

    fun `test reset visibility can be toggled`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })

        panel.setResetVisible(true)

        assertTrue(panel.resetVisibleForTest())
    }

    fun `test prompt editor exposes send context`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val sink = TestSink()

        (panel.defaultFocusedComponent as UiDataProvider).uiDataSnapshot(sink)

        assertSame(panel, sink.send)
    }

    fun `test prompt button exposes send context`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val sink = TestSink()

        (panel.buttonForTest() as UiDataProvider).uiDataSnapshot(sink)

        assertSame(panel, sink.send)
    }

    fun `test prompt paste provider invokes registered handler`() {
        val editor = createEditor()
        val item = FileListTransferable(listOf(File.createTempFile("kilo-paste", ".txt")))
        var seen: Transferable? = null
        editor.putUserData(PROMPT_ATTACHMENT_PASTE_HANDLER_KEY, PromptAttachmentPasteHandler { seen = it })

        try {
            PromptAttachmentPasteProvider().performPaste(pasteContext(editor, item))

            assertSame(item, seen)
        } finally {
            EditorFactory.getInstance().releaseEditor(editor)
        }
    }

    fun `test file list paste adds attachment`() {
        val panel = PromptPanel(project, { _, _ -> }, {}, { _, _ -> })
        val file = File.createTempFile("kilo-paste", ".txt")
        file.writeText("hello")

        PlatformTestUtil.waitForFuture(panel.processPasteForTest(FileListTransferable(listOf(file))))
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(1, panel.attachmentCountForTest())
    }

    fun `test frontend file attachment defers data url encoding until send`() {
        val file = File.createTempFile("kilo-paste", ".txt")
        file.writeText("hello")

        val item = ai.kilocode.client.session.model.PromptAttachmentExtractor.files(listOf(file)).single()

        assertTrue(item.url.startsWith("file://"))
        assertTrue(item.part().url.orEmpty().startsWith("data:text/plain;base64,"))
    }

    fun `test pasted frontend file sends data url payload`() {
        var sent: ai.kilocode.rpc.dto.PromptPartDto? = null
        val panel = PromptPanel(project, { _, files -> sent = files.single() }, {}, { _, _ -> })
        val file = File.createTempFile("kilo-paste", ".txt")
        file.writeText("hello")
        panel.setReady(true)

        PlatformTestUtil.waitForFuture(panel.processPasteForTest(FileListTransferable(listOf(file))))
        UIUtil.dispatchAllInvocationEvents()
        panel.send()
        waitForSend { sent != null }

        val item = sent!!
        assertEquals("text/plain", item.mime)
        assertTrue(item.url.orEmpty().startsWith("data:text/plain;base64,"))
        assertFalse(item.url.orEmpty().startsWith("file://"))
    }

    fun `test raw image paste adds attachment`() {
        val panel = PromptPanel(project, { _, _ -> }, {}, { _, _ -> })
        val image = BufferedImage(2, 2, BufferedImage.TYPE_INT_ARGB)

        PlatformTestUtil.waitForFuture(panel.processPasteForTest(ImageTransferable(image)))
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(1, panel.attachmentCountForTest())
    }

    fun `test file paste ignores companion image flavor`() {
        val panel = PromptPanel(project, { _, _ -> }, {}, { _, _ -> })
        val file = File.createTempFile("kilo-paste", ".png")
        file.writeBytes(byteArrayOf())
        val image = BufferedImage(2, 2, BufferedImage.TYPE_INT_ARGB)

        PlatformTestUtil.waitForFuture(panel.processPasteForTest(FileImageTransferable(listOf(file), image)))
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(1, panel.attachmentCountForTest())
    }

    fun `test normal text paste is not intercepted`() {
        val editor = createEditor()
        val provider = PromptAttachmentPasteProvider()
        editor.putUserData(PROMPT_ATTACHMENT_PASTE_HANDLER_KEY, PromptAttachmentPasteHandler {})

        try {
            assertFalse(provider.isPasteEnabled(pasteContext(editor, StringSelection("hello"))))
        } finally {
            EditorFactory.getInstance().releaseEditor(editor)
        }
    }

    fun `test disabled media model blocks pasted image`() {
        val panel = PromptPanel(project, { _, _ -> }, {}, { _, _ -> })
        panel.setAttachmentEnabled(false)

        PlatformTestUtil.waitForFuture(panel.processPasteForTest(ImageTransferable(BufferedImage(2, 2, BufferedImage.TYPE_INT_ARGB))))
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(0, panel.attachmentCountForTest())
    }

    fun `test prompt button switches between send and stop state`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })

        assertEquals(KeymapUtil.createTooltipText("Send", "Kilo.SendPrompt"), panel.buttonForTest().toolTipText)
        assertFalse(panel.isStopEnabled)

        panel.setBusy(true)

        assertEquals("Stop", panel.buttonForTest().toolTipText)
        assertTrue(panel.isStopEnabled)
    }

    fun `test auto approve button toggles and updates tooltip`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val button = autoApproveButton(panel)
        var seen: Boolean? = null
        panel.onAutoApproveToggle = { seen = it }

        assertFalse(button.isSelected)
        assertEquals(KiloBundle.message("prompt.action.autoApprove.enable"), button.accessibleContext.accessibleName)
        assertEquals(KiloBundle.message("prompt.action.autoApprove.disabled.tooltip"), button.toolTipText)
        val icon = button.icon

        button.doClick()

        assertEquals(true, seen)

        panel.setAutoApprove(true)

        assertTrue(button.isSelected)
        assertNotSame(icon, button.icon)
        assertEquals(KiloBundle.message("prompt.action.autoApprove.disable"), button.accessibleContext.accessibleName)
        assertEquals(KiloBundle.message("prompt.action.autoApprove.enabled.tooltip"), button.toolTipText)

        button.doClick()

        assertEquals(false, seen)

        panel.setAutoApprove(false)

        assertSame(icon, button.icon)
    }

    fun `test auto approve and enhance buttons sit next to send button`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val auto = autoApproveButton(panel)
        val enhance = enhanceButton(panel)
        val send = panel.buttonForTest()
        val items = auto.parent.components.toList()

        assertTrue(SwingUtilities.isDescendingFrom(auto, panel.shellForTest()))
        assertSame(auto.parent, enhance.parent)
        assertSame(auto.parent, send.parent)
        assertEquals(2, items.indexOf(enhance) - items.indexOf(auto))
        assertEquals(2, items.indexOf(send) - items.indexOf(enhance))
    }

    fun `test enhance button follows connection and busy state`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val enhance = enhanceButton(panel)

        assertFalse(enhance.isEnabled)

        panel.setReady(true)
        assertTrue(enhance.isEnabled)

        panel.setBusy(true)
        assertFalse(enhance.isEnabled)

        panel.setBusy(false)
        assertTrue(enhance.isEnabled)
    }

    fun `test enhance button rewrites active draft`() {
        var seen: String? = null
        var complete: ((Result<String>) -> Unit)? = null
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { text, done ->
            seen = text
            complete = done
        })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val enhance = enhanceButton(panel)
        panel.setReady(true)
        editor.text = "  make a plan  "

        enhance.doClick()

        assertEquals("make a plan", seen)
        assertFalse(enhance.isEnabled)
        assertTrue(enhance.icon is AnimatedIcon)
        val icon = enhance.icon

        panel.setReady(true)

        assertSame(icon, enhance.icon)

        complete!!(Result.success("Use a focused implementation plan"))

        assertEquals("Use a focused implementation plan", editor.text)
        assertTrue(enhance.isEnabled)
        assertFalse(enhance.icon is AnimatedIcon)
    }

    fun `test edit while enhancing ignores stale completion`() {
        var complete: ((Result<String>) -> Unit)? = null
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, done -> complete = done })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val enhance = enhanceButton(panel)
        panel.setReady(true)
        editor.text = "first draft"

        enhance.doClick()
        editor.text = "edited draft"
        complete!!(Result.success("stale result"))

        assertEquals("edited draft", editor.text)
        assertTrue(enhance.isEnabled)
    }

    fun `test cancelled enhancement restores button without notification`() {
        val notes = mutableListOf<Notification>()
        val listener = object : Notifications {
            override fun notify(notification: Notification) {
                notes.add(notification)
            }
        }
        ApplicationManager.getApplication().messageBus.connect(testRootDisposable).subscribe(Notifications.TOPIC, listener)
        project.messageBus.connect(testRootDisposable).subscribe(Notifications.TOPIC, listener)
        var complete: ((Result<String>) -> Unit)? = null
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, done -> complete = done })
        val editor = panel.defaultFocusedComponent as EditorTextField
        val enhance = enhanceButton(panel)
        panel.setReady(true)
        editor.text = "keep this draft"

        enhance.doClick()
        complete!!(Result.failure(CancellationException("disposed")))

        assertEquals("keep this draft", editor.text)
        assertTrue(enhance.isEnabled)
        assertFalse(enhance.icon is AnimatedIcon)
        assertTrue(notes.isEmpty())
    }

    fun `test empty enhancement inserts explanation without request`() {
        var requests = 0
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> requests++ })
        val editor = panel.defaultFocusedComponent as EditorTextField
        panel.setReady(true)

        enhanceButton(panel).doClick()

        assertEquals(0, requests)
        assertEquals(KiloBundle.message("prompt.action.enhance.description"), editor.text)
    }

    fun `test pickers belong to rounded shell`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val shell = panel.shellForTest()

        assertTrue(SwingUtilities.isDescendingFrom(panel.mode, shell))
        assertTrue(SwingUtilities.isDescendingFrom(panel.model, shell))
        assertTrue(SwingUtilities.isDescendingFrom(panel.reasoning, shell))
        assertSame(shell, panel.mode.parent.parent)
    }

    private fun autoApproveButton(panel: PromptPanel): JButton {
        val enable = KiloBundle.message("prompt.action.autoApprove.enable")
        val disable = KiloBundle.message("prompt.action.autoApprove.disable")
        return buttons(panel).first {
            val name = it.accessibleContext.accessibleName
            name == enable || name == disable
        }
    }

    private fun attachmentRemoveButton(panel: PromptPanel, item: PromptAttachment): JButton {
        val name = KiloBundle.message("prompt.attachment.remove", item.name)
        return buttons(panel).first { it.accessibleContext.accessibleName == name }
    }

    private fun attachmentCard(root: java.awt.Component): AttachmentCard {
        fun visit(node: java.awt.Component): AttachmentCard? {
            if (node is AttachmentCard) return node
            if (node is Container) {
                for (child in node.components) {
                    val card = visit(child)
                    if (card != null) return card
                }
            }
            return null
        }
        return visit(root)!!
    }

    private fun enhanceButton(panel: PromptPanel): JButton {
        val name = KiloBundle.message("prompt.action.enhance")
        return buttons(panel).first { it.accessibleContext.accessibleName == name }
    }

    private fun buttons(root: java.awt.Component): List<JButton> {
        val out = mutableListOf<JButton>()
        fun visit(node: java.awt.Component) {
            if (node is JButton) out.add(node)
            if (node is Container) node.components.forEach(::visit)
        }
        visit(root)
        return out
    }

    private fun labels(root: java.awt.Component): List<JBLabel> {
        return components(root).filterIsInstance<JBLabel>()
    }

    private fun components(root: java.awt.Component): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        fun visit(node: java.awt.Component) {
            out.add(node)
            if (node is Container) node.components.forEach(::visit)
        }
        visit(root)
        return out
    }

    private fun realize(panel: Component, width: Int, height: Int): SessionRootPanel {
        val root = SessionRootPanel()
        root.setSize(width, height)
        root.content.add(JPanel(BorderLayout()).apply { add(panel, BorderLayout.SOUTH) }, BorderLayout.CENTER)
        root.addNotify()
        root.doLayout()
        panel.doLayout()
        UIUtil.dispatchAllInvocationEvents()
        roots.add(root)
        return root
    }

    private fun toolbarControl(): EditorTextField {
        val doc = LanguageTextField.createDocument(
            "",
            PlainTextLanguage.INSTANCE,
            project,
            LanguageTextField.SimpleDocumentCreator(),
        )
        return EditorTextField(doc, project, PlainTextFileType.INSTANCE, false, false)
    }

    private fun paint(component: Component, x: Int, y: Int): Color {
        val image = BufferedImage(component.width, component.height, BufferedImage.TYPE_INT_ARGB)
        val g = image.createGraphics()
        try {
            component.paint(g)
        } finally {
            g.dispose()
        }
        return Color(image.getRGB(x, y), true)
    }

    private fun completion() = KiloPromptCompletionProvider(
        workspace = workspaces.workspace("/test"),
        service = workspaces,
        actions = listOf(
            SlashAction(SlashAction.NEW.name, "New") {},
            SlashAction("next", "Next") {},
        ),
        mentions = listOf(MentionAction(
            MentionAction.GIT_CHANGES.name,
            "Git Changes",
            available = MentionAction.GIT_CHANGES.available,
        )),
        scope = scope,
    )

    private fun invokeCompletionAction(editor: Editor) {
        val action = ActionUtil.getActions(editor.contentComponent).first { item ->
            item.templatePresentation.text == "Kilo Prompt Completion"
        }
        val event = event(action, editor)
        ActionUtil.updateAction(action, event)
        ActionUtil.performAction(action, event)
    }

    private fun invokeComponentAction(text: String, editor: Editor) {
        val action = ActionUtil.getActions(editor.contentComponent).first { item ->
            item.templatePresentation.text == text
        }
        val event = event(action, editor)
        ActionUtil.updateAction(action, event)
        assertTrue("action $text should be enabled", event.presentation.isEnabled)
        ActionUtil.performAction(action, event)
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun invokeAction(id: String, component: java.awt.Component, file: TextEditor) {
        val action = ActionManager.getInstance().getAction(id) ?: error("missing action $id")
        val ctx = DataContext { data ->
            when (data) {
                CommonDataKeys.PROJECT.name -> project
                PlatformCoreDataKeys.CONTEXT_COMPONENT.name -> component
                PlatformCoreDataKeys.FILE_EDITOR.name -> file
                else -> null
            }
        }
        val event = AnActionEvent.createEvent(action, ctx, null, ActionPlaces.UNKNOWN, ActionUiKind.NONE, null)
        ActionUtil.updateAction(action, event)
        assertTrue("action $id should be enabled", event.presentation.isEnabled)
        ActionUtil.performAction(action, event)
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun waitForLookupItems(editor: Editor): List<String> {
        repeat(50) {
            UIUtil.dispatchAllInvocationEvents()
            val items = LookupManager.getActiveLookup(editor)?.items.orEmpty().map { item -> item.lookupString }
            if (items.isNotEmpty()) return items
            Thread.sleep(20)
        }
        return LookupManager.getActiveLookup(editor)?.items.orEmpty().map { it.lookupString }
    }

    private fun acceptLookup(editor: Editor) {
        val lookup = LookupManager.getActiveLookup(editor) as? LookupImpl ?: error("missing lookup")
        lookup.finishLookup(Lookup.NORMAL_SELECT_CHAR)
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun file(path: String) = WorkspaceFileDto(
        path = path,
        name = path.substringAfterLast('/'),
    )

    private fun event(action: AnAction, editor: Editor): AnActionEvent {
        val ctx = DataContext { id ->
            when (id) {
                CommonDataKeys.EDITOR.name -> editor
                CommonDataKeys.PROJECT.name -> project
                else -> null
            }
        }
        return AnActionEvent.createEvent(action, ctx, null, ActionPlaces.UNKNOWN, ActionUiKind.NONE, null)
    }

    private fun spans(field: EditorTextField): List<Pair<String, com.intellij.openapi.editor.colors.TextAttributesKey?>> {
        val editor = field.getEditor(false)!!
        return editor.markupModel.allHighlighters.map {
            field.text.substring(it.startOffset, it.endOffset) to it.textAttributesKey
        }
    }

    private fun hasFloatingToolbar(component: Component): Boolean {
        if (component.javaClass.name == FLOATING) return true
        if (component !is Container) return false
        return component.components.any(::hasFloatingToolbar)
    }

    private fun createEditor(): Editor {
        val factory = EditorFactory.getInstance()
        return factory.createEditor(factory.createDocument(""), project)
    }

    private fun waitForSend(done: () -> Boolean) {
        repeat(50) {
            UIUtil.dispatchAllInvocationEvents()
            if (done()) return
            Thread.sleep(20)
        }
    }

    private fun pasteContext(editor: Editor, item: Transferable) = DataContext { id ->
        when (id) {
            CommonDataKeys.EDITOR.name -> editor
            PasteAction.TRANSFERABLE_PROVIDER.name -> Producer { item }
            else -> null
        }
    }

    private class FileListTransferable(private val files: List<File>) : Transferable {
        override fun getTransferDataFlavors(): Array<DataFlavor> = arrayOf(DataFlavor.javaFileListFlavor)

        override fun isDataFlavorSupported(flavor: DataFlavor): Boolean = flavor == DataFlavor.javaFileListFlavor

        override fun getTransferData(flavor: DataFlavor): Any {
            if (!isDataFlavorSupported(flavor)) throw java.awt.datatransfer.UnsupportedFlavorException(flavor)
            return files
        }
    }

    private class ImageTransferable(private val image: BufferedImage) : Transferable {
        override fun getTransferDataFlavors(): Array<DataFlavor> = arrayOf(DataFlavor.imageFlavor)

        override fun isDataFlavorSupported(flavor: DataFlavor): Boolean = flavor == DataFlavor.imageFlavor

        override fun getTransferData(flavor: DataFlavor): Any {
            if (!isDataFlavorSupported(flavor)) throw java.awt.datatransfer.UnsupportedFlavorException(flavor)
            return image
        }
    }

    private class FileImageTransferable(
        private val files: List<File>,
        private val image: BufferedImage,
    ) : Transferable {
        override fun getTransferDataFlavors(): Array<DataFlavor> = arrayOf(
            DataFlavor.javaFileListFlavor,
            DataFlavor.imageFlavor,
        )

        override fun isDataFlavorSupported(flavor: DataFlavor): Boolean {
            return flavor == DataFlavor.javaFileListFlavor || flavor == DataFlavor.imageFlavor
        }

        override fun getTransferData(flavor: DataFlavor): Any {
            if (flavor == DataFlavor.javaFileListFlavor) return files
            if (flavor == DataFlavor.imageFlavor) return image
            throw java.awt.datatransfer.UnsupportedFlavorException(flavor)
        }
    }

    private class TestFocusManager : DefaultKeyboardFocusManager() {
        fun focus(component: Component) {
            setGlobalFocusOwner(component)
        }
    }

    private class TestSink : CopyProviderSink() {
        var send: Any? = null
        var file: Any? = null

        override fun <T : Any> set(key: DataKey<T>, data: T?) {
            super.set(key, data)
            if (key == PromptDataKeys.SEND) send = data
            if (key == PlatformCoreDataKeys.FILE_EDITOR) file = data
        }
    }

}
