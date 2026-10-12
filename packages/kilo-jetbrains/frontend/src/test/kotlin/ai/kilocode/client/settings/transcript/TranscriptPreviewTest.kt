package ai.kilocode.client.settings.transcript

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.settings.BlockDisplay
import ai.kilocode.client.session.settings.ReasoningDisplay
import ai.kilocode.client.session.settings.TranscriptDisplay
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.util.edtWait
import com.intellij.openapi.editor.EditorFactory
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import kotlin.math.abs

@Suppress("UnstableApiUsage")
class TranscriptPreviewTest : BasePlatformTestCase() {

    private lateinit var timers: TestUiTimers

    override fun setUp() {
        super.setUp()
        timers = TestUiTimers()
    }

    override fun tearDown() {
        try {
            KiloPluginSettings.unsetReasoningDisplay()
            KiloPluginSettings.unsetTerminalCommandDisplay()
            KiloPluginSettings.unsetCodeEditDisplay()
            KiloPluginSettings.unsetMcpToolDisplay()
            KiloPluginSettings.unsetShowApprovalReason()
            KiloPluginSettings.unsetHoverPreview()
        } finally {
            super.tearDown()
        }
    }

    fun `test preview renders one card per configurable block kind`() = edtUnit {
        open(expanded()) { preview ->
            preview.reasoningCard()
            preview.shellCard()
            preview.editCard()
            preview.mcpCard()
        }
    }

    fun `test sample elements appear one by one every half second`() = edtUnit {
        val preview = TranscriptPreview(display = { expanded() }, timers = timers)
        try {
            assertEquals("reasoning appears immediately", 1, preview.visibleCardCount())
            timers.advanceBy(PREVIEW_STEP_MS - 1L)
            assertEquals(1, preview.visibleCardCount())
            timers.advanceBy(1)
            assertEquals("terminal appears at 500ms", 2, preview.visibleCardCount())
            timers.advanceBy(PREVIEW_STEP_MS.toLong())
            assertEquals("diff appears at 1000ms", 3, preview.visibleCardCount())
            timers.advanceBy(PREVIEW_STEP_MS.toLong())
            assertEquals("MCP appears at 1500ms", 4, preview.visibleCardCount())
        } finally {
            preview.dispose()
        }
    }

    // The sample sits inside SessionRootPanel, a JLayeredPane whose preferred size only measures its
    // content panel. Adding the transcript anywhere else leaves the preview measuring as bare padding,
    // so it collapses to nothing and the pane renders blank.
    fun `test preview reports a layout size and places cards on screen`() = edtUnit {
        open(expanded()) { preview ->
            val card = preview.reasoningCard()
            assertTrue(
                "the sample must contribute to the preview's measured height",
                preview.preferredSize.height >= card.preferredSize.height,
            )

            preview.setSize(600, 400)
            layoutTree(preview)

            assertTrue("reasoning card must be laid out", card.width > 0 && card.height > 0)
        }
    }

    // The sample should read like the real chat, which pads the transcript on all four sides.
    fun `test sample uses the standard transcript insets`() = edtUnit {
        open(expanded()) { preview ->
            preview.setSize(1200, 800)
            layoutTree(preview)
            val message = preview.messageForTest()
            assertTrue(
                "message clears the standard top inset",
                message.y >= JBUI.scale(SessionUiStyle.SessionLayout.INNER_TOP),
            )
            assertTrue(
                "message clears the standard horizontal inset",
                message.x >= JBUI.scale(SessionUiStyle.SessionLayout.INNER_HORIZONTAL),
            )
        }
    }

    fun `test sample uses half the standard readable width and is centered`() = edtUnit {
        open(expanded()) { preview ->
            preview.setSize(1200, 800)
            layoutTree(preview)
            val message = preview.messageForTest()
            val transcript = preview.transcriptForTest()
            val cap = SessionUiStyle.SessionLayout.readableWidth(
                transcript,
                SessionEditorStyle.current().transcriptFont,
            ) / 2

            assertTrue(
                "centered lane must match the half-width cap $cap, got ${message.width}",
                message.width <= cap,
            )
            // The lane is centered, so the gaps on either side are close. Do not assert an exact pixel:
            // the half-width cap comes from font metrics and the transcript insets reserve edge width,
            // both of which differ between machines. Allow one inset plus a couple of pixels; an actually
            // off-centre lane is hundreds of pixels out, so this still catches a regression.
            val slack = JBUI.scale(SessionUiStyle.SessionLayout.INNER_HORIZONTAL + 2)
            val leftGap = message.x
            val rightGap = transcript.width - message.x - message.width
            assertTrue(
                "half-width message must be centered, left=$leftGap right=$rightGap width=${message.width}",
                abs(leftGap - rightGap) <= slack,
            )
        }
    }

    fun `test preview reflects each draft block setting`() = edtUnit {
        open(expanded(mcpTool = BlockDisplay.COLLAPSED)) { preview ->
            assertTrue(preview.reasoningCard().isExpanded())
            assertTrue(preview.shellCard().isExpanded())
            assertTrue(preview.editCard().isExpanded())
            assertFalse(preview.mcpCard().isExpanded())
        }
    }

    fun `test code edit sample renders a real unified diff`() = edtUnit {
        open(expanded()) { preview ->
            val edit = preview.editCard()
            assertEquals(6 to 2, edit.diffStat())
            assertTrue(edit.bodyText().contains("+        val expandEdits = true"))
            assertTrue(edit.markdown().contains("patch-pure"))
        }
    }

    fun `test preview applies the headline reasoning mode`() = edtUnit {
        open(expanded(reasoning = ReasoningDisplay.HEADLINE)) { preview ->
            assertFalse(preview.reasoningCard().isExpanded())
            assertFalse(preview.reasoningCard().bodyCreated())
        }
    }

    // A finished reasoning block renders identically in Preview and Headline, so the sample must stream
    // for all three modes to be observable: full text, capped scroll, header only. The tree is validated
    // between steps because SessionLayout caches a child's height while the child reports isValid, which
    // is what freezes the sample in a real dialog.
    fun `test every reasoning mode is observable in the sample`() = edtUnit {
        var draft = expanded(reasoning = ReasoningDisplay.EXPANDED)
        val preview = TranscriptPreview(display = { draft }, timers = timers)
        try {
            val full = settle(preview) { preview.reasoningCard().height }
            assertTrue("expanded reasoning is open", preview.reasoningCard().isExpanded())

            draft = draft.copy(reasoning = ReasoningDisplay.PREVIEW)
            preview.replay()
            val capped = settle(preview) { preview.reasoningCard().height }
            assertTrue("preview reasoning stays open", preview.reasoningCard().isExpanded())
            assertTrue("preview must cap a long body below the full height, $capped vs $full", capped < full)

            draft = draft.copy(reasoning = ReasoningDisplay.HEADLINE)
            preview.replay()
            val headline = settle(preview) { preview.reasoningCard().height }
            assertFalse("headline reasoning is closed", preview.reasoningCard().isExpanded())
            assertTrue("headline must be shorter than the capped body, $headline vs $capped", headline < capped)
        } finally {
            preview.dispose()
        }
    }

    fun `test terminal setting changes the sample card`() = edtUnit {
        var draft = expanded(terminal = BlockDisplay.COLLAPSED)
        val preview = TranscriptPreview(display = { draft }, timers = timers)
        try {
            revealAll()
            val closed = settle(preview) { preview.shellCard().height }
            assertFalse("collapsed terminal starts closed", preview.shellCard().isExpanded())

            draft = draft.copy(terminal = BlockDisplay.EXPANDED)
            preview.replay()
            revealAll()
            val open = settle(preview) { preview.shellCard().height }

            assertTrue("expanded terminal opens", preview.shellCard().isExpanded())
            assertTrue("opening the terminal card must grow it, $closed then $open", open > closed)
        } finally {
            preview.dispose()
        }
    }

    fun `test refresh pushes a changed draft into the cards`() = edtUnit {
        var draft = expanded()
        val preview = TranscriptPreview(display = { draft }, timers = timers)
        try {
            revealAll()
            assertTrue(preview.reasoningCard().isExpanded())

            draft = draft.copy(reasoning = ReasoningDisplay.HEADLINE)
            preview.replay()

            assertEquals("replay starts over with reasoning", 1, preview.visibleCardCount())
            assertFalse(preview.reasoningCard().isExpanded())
            assertFalse(preview.reasoningCard().bodyCreated())
        } finally {
            preview.dispose()
        }
    }

    fun `test preview never mutates persisted preferences`() = edtUnit {
        val saved = KiloPluginSettings.getTranscriptDisplay()
        open(expanded(reasoning = ReasoningDisplay.HEADLINE, terminal = BlockDisplay.COLLAPSED)) { }
        assertEquals(saved, KiloPluginSettings.getTranscriptDisplay())
    }

    fun `test repeated replay replaces cards without growing the tree`() = edtUnit {
        open(expanded()) { preview ->
            val before = countDescendants(preview)

            repeat(100) {
                preview.replay()
                revealAll()
            }
            UIUtil.dispatchAllInvocationEvents()

            assertEquals("replay replaces cards without growing the tree", before, countDescendants(preview))
        }
    }

    fun `test disposing the preview releases code editors`() = edtUnit {
        val base = EditorFactory.getInstance().allEditors.size
        val preview = TranscriptPreview(display = { expanded() }, timers = timers)
        revealAll()
        preview.reasoningCard().md.component
        UIUtil.dispatchAllInvocationEvents()

        preview.dispose()
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    // -- helpers --

    private fun <T> open(display: TranscriptDisplay, block: (TranscriptPreview) -> T): T {
        val preview = TranscriptPreview(display = { display }, timers = timers)
        return try {
            revealAll()
            block(preview)
        } finally {
            preview.dispose()
        }
    }

    private fun expanded(
        reasoning: ReasoningDisplay = ReasoningDisplay.EXPANDED,
        terminal: BlockDisplay = BlockDisplay.EXPANDED,
        codeEdit: BlockDisplay = BlockDisplay.EXPANDED,
        mcpTool: BlockDisplay = BlockDisplay.EXPANDED,
        approvalReason: Boolean = true,
        hoverPreview: Boolean = true,
    ) = TranscriptDisplay(reasoning, terminal, codeEdit, mcpTool, approvalReason, hoverPreview)

    private fun countDescendants(component: java.awt.Component): Int {
        if (component !is java.awt.Container) return 0
        return component.components.sumOf { 1 + countDescendants(it) }
    }

    private fun layoutTree(component: java.awt.Component) {
        component.doLayout()
        if (component is java.awt.Container) component.components.forEach { layoutTree(it) }
    }

    /**
     * Pushes the current draft in, then lays the sample out the way a shown dialog would: `validate`
     * marks children valid, which is the freshness signal [ai.kilocode.client.session.ui.SessionLayout]
     * caches against. Reading geometry without it would never see a stale measurement.
     */
    private fun <T> settle(preview: TranscriptPreview, read: () -> T): T {
        preview.setSize(600, 2000)
        preview.validate()
        layoutTree(preview)
        preview.validate()
        return read()
    }

    private fun revealAll() {
        repeat(3) { timers.advanceBy(PREVIEW_STEP_MS.toLong()) }
        UIUtil.dispatchAllInvocationEvents()
    }

    /**
     * JUnit3 only discovers `void` test methods, so an expression-bodied test whose lambda yields a
     * value is silently skipped. Test bodies use this so they stay Unit-returning.
     */
    private fun edtUnit(block: () -> Unit) {
        edtWait(block)
    }
}
