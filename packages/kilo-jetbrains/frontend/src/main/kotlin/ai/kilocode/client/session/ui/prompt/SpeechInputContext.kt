package ai.kilocode.client.session.ui.prompt

interface SpeechInputContext {
    val isSpeechEnabled: Boolean

    fun toggleSpeech()
}
