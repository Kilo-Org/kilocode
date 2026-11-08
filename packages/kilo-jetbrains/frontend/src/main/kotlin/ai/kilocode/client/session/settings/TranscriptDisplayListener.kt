package ai.kilocode.client.session.settings

import com.intellij.util.messages.Topic

/** Broadcast when transcript appearance preferences should be reapplied to live session views. */
fun interface TranscriptDisplayListener {
    fun changed(display: TranscriptDisplay)

    companion object {
        @JvmField
        val TOPIC: Topic<TranscriptDisplayListener> = Topic.create(
            "Kilo transcript display",
            TranscriptDisplayListener::class.java,
        )
    }
}

/** Implemented by transcript cards whose automatic expanded state is controlled by display prefs. */
interface TranscriptDisplayTarget {
    /**
     * Reapplies [display] and returns true when layout or paint output changed. A card the user has
     * manually expanded or collapsed keeps its state unless [force] is set, which the settings
     * preview uses to reflect an unsaved draft over a manual preview toggle.
     */
    fun syncTranscriptDisplay(display: TranscriptDisplay, force: Boolean = false): Boolean
}
