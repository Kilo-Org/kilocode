package ai.kilocode.client.session.settings

import com.intellij.util.messages.Topic

/**
 * Fired whenever the compact transcript mode master switch or any of its per-category grouping
 * toggles changes. Carries no payload — listeners re-read [ai.kilocode.client.plugin.KiloPluginSettings]
 * because the four category settings move independently and a listener only cares about the
 * combined outcome.
 */
fun interface CompactModeListener {
    fun changed()

    companion object {
        @JvmField
        val TOPIC: Topic<CompactModeListener> = Topic.create(
            "Kilo compact transcript mode",
            CompactModeListener::class.java,
        )
    }
}
