package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.ui.attachment.AttachmentCardItem
import ai.kilocode.client.session.ui.attachment.AttachmentChip
import ai.kilocode.client.ui.UiStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import java.awt.Container

class PromptAttachmentViewTest : BasePlatformTestCase() {
    // The attachment strip should line up with the prompt text horizontally and keep only a
    // small standard bottom inset below the selection reference.
    fun `test attachment padding matches prompt text with small bottom inset`() {
        val prompt = PromptView(Text("p1")).insets
        val attach = PromptAttachmentView("m1") {}.insets

        assertEquals(prompt.left, attach.left)
        assertEquals(prompt.right, attach.right)
        assertEquals(0, attach.top)
        assertEquals(UiStyle.Gap.sm(), attach.bottom)
    }

    fun `test attachment scroll pane has no border line`() {
        val scroll = PromptAttachmentView("m1") {}.scrollPane()

        assertEquals(0, scroll.border.getBorderInsets(scroll).top)
        assertEquals(0, scroll.border.getBorderInsets(scroll).left)
        assertEquals(0, scroll.border.getBorderInsets(scroll).bottom)
        assertEquals(0, scroll.border.getBorderInsets(scroll).right)
        assertEquals(0, scroll.viewportBorder.getBorderInsets(scroll).top)
        assertEquals(0, scroll.viewportBorder.getBorderInsets(scroll).left)
        assertEquals(0, scroll.viewportBorder.getBorderInsets(scroll).bottom)
        assertEquals(0, scroll.viewportBorder.getBorderInsets(scroll).right)
    }

    // With the outline removed, the chip owns no internal padding; alignment comes from the
    // container so the chip content sits flush against the prompt-matching insets.
    fun `test attachment chip has no outline padding`() {
        val chip = AttachmentChip(
            AttachmentCardItem("HvJwtFilter.java", "text/plain", "file:///HvJwtFilter.java"),
            file = true,
            startLine = 40,
            endLine = 42,
        ).insets

        assertEquals(0, chip.left)
        assertEquals(0, chip.right)
        assertEquals(0, chip.top)
        assertEquals(0, chip.bottom)
    }

    fun `test attachment chip uses file link underline style`() {
        val chip = AttachmentChip(
            AttachmentCardItem("HvJwtFilter.java", "text/plain", "file:///HvJwtFilter.java"),
            file = true,
            startLine = 40,
            endLine = 42,
        )
        val label = components(chip).filterIsInstance<JBLabel>().single()

        assertTrue(label.text.contains("<u>HvJwtFilter.java:40-42</u>"))
    }

    private fun components(root: Container): List<java.awt.Component> = buildList {
        fun visit(comp: java.awt.Component) {
            add(comp)
            if (comp is Container) comp.components.forEach { visit(it) }
        }
        visit(root)
    }
}
