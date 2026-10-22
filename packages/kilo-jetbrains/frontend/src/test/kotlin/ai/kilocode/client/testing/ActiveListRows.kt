package ai.kilocode.client.testing

import ai.kilocode.client.ui.FadeText
import java.awt.Color
import java.awt.Component
import java.awt.Container

/**
 * The two text lines of a rendered `ActiveList` row: the title, then the description under it.
 *
 * Both are [FadeText], so neither can be picked out of the tree by type alone. They are taken in tree
 * order, which is the order the renderer stacks them in, and the count is checked so a renderer that grew
 * a third line fails here instead of silently handing back the wrong one.
 */
internal fun rowLines(renderer: Component): Pair<FadeText, FadeText> {
    val texts = descendants(renderer).filterIsInstance<FadeText>()
    check(texts.size == 2) { "expected a title and a description line, found ${texts.size}" }
    return texts[0] to texts[1]
}

/** The title line of a rendered `ActiveList` row. */
internal fun rowTitle(renderer: Component): FadeText = rowLines(renderer).first

/** The description line of a rendered `ActiveList` row. */
internal fun rowDescription(renderer: Component): FadeText = rowLines(renderer).second

/**
 * The color the first fragment of [text] is painted in.
 *
 * A row line carries its color in its fragment attributes rather than in `foreground`, because a
 * [FadeText] paints text the way every [com.intellij.ui.SimpleColoredComponent] does.
 */
internal fun lineColor(text: FadeText): Color? {
    val fragments = text.iterator()
    fragments.next()
    return fragments.textAttributes.fgColor
}

private fun descendants(root: Component): List<Component> {
    val out = mutableListOf(root)
    if (root is Container) root.components.forEach { out += descendants(it) }
    return out
}
