package ai.kilocode.client.actions

import ai.kilocode.client.testing.PluginDescriptor
import ai.kilocode.client.testing.attribute
import ai.kilocode.client.testing.elements
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.project.DumbAware
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Kilo owns no index-backed action: every one of them resolves its context from a `DataKey` and then
 * calls the CLI, git, or Swing. So none of them may be gated on indexing.
 *
 * The platform decides that per action rather than per plugin, and it does not default the way you
 * would hope: `AnAction.isDumbAware` falls back to `ActionClassMetaData.isDefaultUpdate`, so merely
 * overriding `update(AnActionEvent)` classifies an action as index-dependent. Nearly all of ours
 * override `update` to hide themselves when their data key is absent, which is exactly the shape that
 * trips the fallback.
 *
 * Left unmarked, `ActionUtil.updateAction` force-disables the action in popup places, swaps its
 * tooltip for "waits for analysis", and `ActionUtil.performAction` then refuses to run it at all —
 * so a row menu goes dead, or worse, half-dead next to its already-marked siblings.
 */
class DeclaredActionsDumbAwareTest : BasePlatformTestCase() {

    /**
     * The ratchet. Implicit dumb-awareness is not enough to rely on: an action that happens to lack an
     * `update` override passes [AnAction.isDumbAware] today and silently regresses the moment someone
     * adds one. Requiring the explicit supertype makes that regression impossible.
     *
     * Groups are covered too. Every group we declare is classless and so becomes a `DefaultActionGroup`
     * (implicitly dumb-aware), but the day one gains a `class` it needs the same marker.
     */
    fun `test every declared action and group is marked dumb aware`() {
        val descriptor = PluginDescriptor.frontend()
        val declared = (descriptor.elements("action") + descriptor.elements("group"))
            .mapNotNull { element -> element.attribute("class")?.let { element.attribute("id") to it } }

        assertTrue("expected the frontend descriptor to declare actions", declared.isNotEmpty())
        val blocked = declared.filterNot { DumbAware::class.java.isAssignableFrom(Class.forName(it.second)) }

        assertEquals("actions blocked during indexing", emptyList<Pair<String?, String>>(), blocked)
    }

    /**
     * The behaviour behind the ratchet, asserted on real instances through the platform's own
     * predicate rather than on the marker interface. [AnAction.isDumbAware] is what every call site
     * that can strand us consults — `ActionUtil.updateAction` when it decides whether to force-disable
     * a popup item, `ActionUtil.performAction` when it decides whether to run the action at all, and
     * `ToolWindowSetInitializer` for `canWorkInDumbMode` — so agreement here is the property that
     * matters at runtime.
     *
     * Instantiating each one also keeps the descriptor honest about classes and no-arg constructors.
     */
    fun `test the platform treats every declared action as dumb aware`() {
        val classes = PluginDescriptor.frontend().elements("action").mapNotNull { it.attribute("class") }

        assertTrue("expected the frontend descriptor to declare actions", classes.isNotEmpty())
        val gated = classes.filterNot { name ->
            (Class.forName(name).getDeclaredConstructor().newInstance() as AnAction).isDumbAware
        }

        assertEquals("actions the platform would gate on indexing", emptyList<String>(), gated)
    }
}
