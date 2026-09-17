package ai.kilocode.client.actions

import com.intellij.openapi.keymap.KeymapManager
import com.intellij.openapi.util.JDOMUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import org.jdom.Element

/**
 * Guards the keymap declarations for the prompt bar's selector shortcuts.
 *
 * The macOS keymaps inherit from `$default` through `MacOSDefaultKeymap`, which swaps Ctrl and Cmd on
 * every inherited shortcut. A `$default`-only `control <digit>` therefore reaches macOS users as
 * Cmd+digit and collides with the tool window shortcuts (Cmd+1 activates Project). Each mac keymap has
 * to re-declare the literal Ctrl shortcut with `replace-all` to drop the converted one — the same thing
 * the platform does for `GotoBookmark1`, which is why that action stays on Ctrl+1 on macOS.
 *
 * Plugin-declared shortcuts are not applied to keymaps in the unit test environment (not even the
 * long-standing `Kilo.SendPrompt` resolves one), so this asserts the shipped descriptor instead of
 * querying [KeymapManager].
 */
class SessionSelectorShortcutsTest : BasePlatformTestCase() {

    private val expected = mapOf(
        CycleModeAction.ID to "control 1",
        CycleModelAction.ID to "control 2",
        CycleReasoningAction.ID to "control 3",
        ResetModelAction.ID to "control 0",
    )

    fun `test selector shortcuts are declared as Control on the default and macOS keymaps`() {
        for ((id, stroke) in expected) {
            val shortcuts = shortcuts(id)

            assertEquals("$id keymaps", listOf("\$default", "Mac OS X", "Mac OS X 10.5+"), shortcuts.map { it.keymap })
            assertTrue("$id must bind $stroke everywhere", shortcuts.all { it.stroke == stroke })
            // Only the mac keymaps need to drop the Ctrl/Cmd-converted shortcut they inherit.
            assertEquals("$id replace-all", listOf(false, true, true), shortcuts.map { it.replace })
        }
    }

    fun `test selector shortcuts use distinct digits`() {
        assertEquals(expected.size, expected.values.distinct().size)
    }

    fun `test macOS keymap names match the platform constants`() {
        val names = expected.keys.flatMap { id -> shortcuts(id).map { it.keymap } }.distinct()

        assertTrue(KeymapManager.MAC_OS_X_KEYMAP in names)
        assertTrue(KeymapManager.MAC_OS_X_10_5_PLUS_KEYMAP in names)
        assertTrue(KeymapManager.DEFAULT_IDEA_KEYMAP in names)
    }

    private data class Binding(val keymap: String, val stroke: String, val replace: Boolean)

    private fun shortcuts(id: String): List<Binding> {
        val action = actions().firstOrNull { it.getAttributeValue("id") == id } ?: error("missing action $id")
        return action.getChildren("keyboard-shortcut").map {
            Binding(
                keymap = it.getAttributeValue("keymap"),
                stroke = it.getAttributeValue("first-keystroke"),
                replace = it.getAttributeValue("replace-all").toBoolean(),
            )
        }
    }

    private fun actions(): List<Element> {
        val stream = javaClass.getResourceAsStream("/kilo.jetbrains.frontend.xml") ?: error("missing plugin descriptor")
        val root = stream.use { JDOMUtil.load(it) }
        return root.getChild("actions")?.getChildren("action") ?: error("missing actions element")
    }
}
