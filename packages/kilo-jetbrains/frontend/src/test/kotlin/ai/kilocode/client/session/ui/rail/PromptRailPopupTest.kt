package ai.kilocode.client.session.ui.rail

import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBList
import java.awt.Component
import java.awt.Container

class PromptRailPopupTest : BasePlatformTestCase() {
    /**
     * The expandable-item hint renders a truncated row's full text as a strip outside the list bounds, so
     * it escapes the balloon and paints over the ticks the navigator is anchored to.
     */
    fun `test navigator list does not use expandable item hints`() {
        val popup = popup(items(6))

        val list = find(popup.component) ?: error("expected a JBList in the navigator body")
        assertFalse(list.expandableItemsHandler.isEnabled)

        Disposer.dispose(popup.disposable)
    }

    /** The cap is what keeps the balloon inside the room left of the rail instead of being re-pointed. */
    fun `test body honors the width cap`() {
        val popup = popup(items(12))
        val cap = 240

        popup.fitWithin(cap, 400)

        assertTrue(
            "preferred width ${popup.component.preferredSize.width} must not exceed the $cap cap",
            popup.component.preferredSize.width <= cap,
        )
        assertTrue(popup.component.preferredSize.height <= 400)

        Disposer.dispose(popup.disposable)
    }

    private fun popup(items: List<PromptRailItem>) = PromptRailPopup(
        items = items,
        hovered = 0,
        onSelect = {},
        onFirst = {},
        onLatest = {},
    )

    private fun items(count: Int) = List(count) {
        PromptRailItem(
            id = "msg_$it",
            queued = false,
            prompt = "Prompt $it that is long enough to be clamped by the navigator row width",
            answer = "Answer $it that is also long enough to wrap across the two lines the row allows",
        )
    }

    private fun find(root: Component): JBList<*>? {
        if (root is JBList<*>) return root
        if (root !is Container) return null
        return root.components.firstNotNullOfOrNull(::find)
    }
}
