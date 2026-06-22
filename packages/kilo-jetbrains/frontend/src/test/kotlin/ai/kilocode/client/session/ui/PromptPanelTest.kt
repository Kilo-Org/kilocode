package ai.kilocode.client.session.ui

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.PromptAttachment
import ai.kilocode.client.session.ui.attachment.AttachmentCard
import ai.kilocode.client.session.ui.attachment.AttachmentCardItem
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.ui.prompt.PROMPT_ATTACHMENT_PASTE_HANDLER_KEY
import ai.kilocode.client.session.ui.prompt.PromptAttachmentPasteHandler
import ai.kilocode.client.session.ui.prompt.PromptAttachmentPasteProvider
import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.test.CopyProviderSink
import com.intellij.icons.AllIcons
import com.intellij.notification.Notification
import com.intellij.notification.Notifications
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.actions.PasteAction
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.keymap.KeymapUtil
import com.intellij.testFramework.PlatformTestUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBLabel
import com.intellij.util.Producer
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CancellationException
import java.awt.Container
import java.awt.BorderLayout
import java.awt.datatransfer.DataFlavor
import java.awt.datatransfer.StringSelection
import java.awt.datatransfer.Transferable
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

@Suppress("UnstableApiUsage")
class PromptPanelTest : BasePlatformTestCase() {
    private val roots = mutableListOf<SessionRootPanel>()

    override fun tearDown() {
        try {
            roots.asReversed().forEach { it.removeNotify() }
            roots.clear()
        } finally {
            super.tearDown()
        }
    }

    fun `test prompt input uses editor font settings`() {
        val style = SessionEditorStyle.current()
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val font = panel.inputFont()

        assertEquals(style.editorFamily, font.name)
        assertEquals(style.editorSize, font.size)
    }

    fun `test prompt input uses editor background`() {
        val style = SessionEditorStyle.current()
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })

        assertEquals(style.editorScheme.defaultBackground, panel.defaultFocusedComponent.background)
    }

    fun `test applyStyle updates prompt input and height`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        val style = SessionEditorStyle.create(family = "Courier New", size = 26)

        panel.applyStyle(style)

        assertEquals("Courier New", panel.inputFont().name)
        assertEquals(26, panel.inputFont().size)
        assertTrue(panel.preferredSize.height >= 26)
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

    fun `test prompt editor scroll policy keeps horizontal disabled`() {
        val panel = PromptPanel(project = project, onSend = { _, _ -> }, onAbort = {}, onEnhance = { _, _ -> })
        realize(panel, 180, 400)

        val editor = (panel.defaultFocusedComponent as EditorTextField).getEditor(false)!!

        assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED, editor.scrollPane.verticalScrollBarPolicy)
        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, editor.scrollPane.horizontalScrollBarPolicy)
        assertTrue(editor.settings.isUseSoftWraps)
        assertFalse(editor.settings.isPaintSoftWraps)
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

    private fun realize(panel: PromptPanel, width: Int, height: Int): SessionRootPanel {
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

    private class TestSink : CopyProviderSink() {
        var send: Any? = null

        override fun <T : Any> set(key: DataKey<T>, data: T?) {
            super.set(key, data)
            if (key == PromptDataKeys.SEND) send = data
        }
    }

}
