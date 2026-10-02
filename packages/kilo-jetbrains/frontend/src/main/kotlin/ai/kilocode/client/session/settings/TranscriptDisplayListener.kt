package ai.kilocode.client.session.settings

import com.intellij.util.messages.Topic

/** Broadcast when transcript appearance preferences should be reapplied to live session views. */
fun interface TranscriptDisplayListener {
    fun changed()

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
    /** Reapplies the current preference and returns true when layout or paint output changed. */
    fun syncTranscriptDisplay(): Boolean
}
