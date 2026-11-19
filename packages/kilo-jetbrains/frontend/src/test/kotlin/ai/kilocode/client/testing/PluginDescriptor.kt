package ai.kilocode.client.testing

import org.w3c.dom.Document
import org.w3c.dom.Element
import javax.xml.parsers.DocumentBuilderFactory

/**
 * The plugin's declared actions are not registered with `ActionManager` in the test fixture (which is
 * why `BranchDock` null-guards its own lookups), so tests that need the declared shape read the module
 * descriptor off the test classpath instead of asking for a live `ActionGroup`.
 */
internal object PluginDescriptor {
    private const val FRONTEND = "kilo.jetbrains.frontend.xml"

    fun frontend(): Document {
        val stream = PluginDescriptor::class.java.classLoader.getResourceAsStream(FRONTEND)
            ?: error("$FRONTEND missing from the test classpath")
        return stream.use {
            DocumentBuilderFactory.newDefaultInstance().newDocumentBuilder().parse(it)
        }
    }
}

/** Every `<tag>` element in the descriptor, in document order. */
internal fun Document.elements(tag: String): List<Element> {
    val nodes = getElementsByTagName(tag)
    return (0 until nodes.length).map { nodes.item(it) as Element }
}

/** The value of [name], or null when the attribute is absent — `getAttribute` returns "" for both. */
internal fun Element.attribute(name: String): String? = getAttribute(name).takeIf(String::isNotEmpty)
