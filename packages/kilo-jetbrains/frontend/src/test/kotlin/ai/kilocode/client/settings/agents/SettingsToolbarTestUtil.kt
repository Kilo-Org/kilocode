package ai.kilocode.client.settings.agents

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.actionSystem.ActionToolbar
import com.intellij.openapi.actionSystem.Separator
import com.intellij.openapi.actionSystem.impl.ActionButtonWithText
import com.intellij.ui.components.ActionLink
import java.awt.Component
import java.awt.Container
import kotlin.test.assertNull
import kotlin.test.assertTrue

internal fun assertMarketplaceToolbarButton(root: Component) {
    val text = KiloBundle.message("settings.marketplace.displayName")
    assertTrue(components(root).filterIsInstance<ActionLink>().none { it.text == text })
    val btn = components(root).filterIsInstance<ActionButtonWithText>().single { it.presentation.text == text }
    assertNull(btn.presentation.icon)
    val group = components(root)
        .filterIsInstance<ActionToolbar>()
        .map { it.actionGroup.getChildren(null).toList() }
        .single { it.lastOrNull()?.templatePresentation?.text == text }
    assertTrue(group.size > 1)
    assertTrue(group.dropLast(1).lastOrNull() is Separator)
}

private fun components(root: Component): List<Component> {
    val out = mutableListOf<Component>()
    fun visit(item: Component) {
        out += item
        if (item is Container) item.components.forEach { visit(it) }
    }
    visit(root)
    return out
}
