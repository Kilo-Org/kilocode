package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.ui.SessionStyle
import ai.kilocode.client.session.ui.SessionStyleTarget
import javax.swing.JPanel

/**
 * Base class for all part renderers.
 *
 * Each subclass wraps one [Content] subtype and knows how to display
 * and update it. Subclasses extend [JPanel] so they can be added directly
 * to [MessageView] without an extra component wrapper.
 *
 * All methods must be called on the EDT.
 */
abstract class PartView : JPanel(), SessionStyleTarget {

    /** Stable [Content.id] this renderer was created for. */
    abstract val contentId: String

    /**
     * Apply a full content update — replace, not append.
     * Called when [ai.kilocode.client.session.model.SessionModelEvent.ContentUpdated] fires.
     */
    abstract fun update(content: Content)

    /**
     * Append a streaming delta to the existing content.
     * Only meaningful for text-bearing renderers ([TextView], [ReasoningView]);
     * others ignore deltas by default.
     */
    open fun appendDelta(delta: String) {}

    override fun applyStyle(style: SessionStyle) {}

    /** Readable name for test dumps. */
    open fun dumpLabel(): String = javaClass.simpleName
}
