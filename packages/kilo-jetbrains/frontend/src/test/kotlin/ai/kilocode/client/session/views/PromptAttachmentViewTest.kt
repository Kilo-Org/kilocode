package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.ui.attachment.AttachmentCardItem
import ai.kilocode.client.session.ui.attachment.AttachmentChip
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class PromptAttachmentViewTest : BasePlatformTestCase() {
    // The attachment strip should line up with the prompt text: same left, right, and bottom
    // padding as PromptView so the selection reference reads as part of the prompt.
    fun `test attachment padding matches prompt text`() {
        val prompt = PromptView(Text("p1")).insets
        val attach = PromptAttachmentView("m1") {}.insets

        assertEquals(prompt.left, attach.left)
        assertEquals(prompt.right, attach.right)
        assertEquals(prompt.bottom, attach.bottom)
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
}
