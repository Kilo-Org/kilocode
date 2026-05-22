package ai.kilocode.client.session.ui.prompt

interface SendPromptContext {
    val isSendEnabled: Boolean
    val isStopEnabled: Boolean

    fun send()

    fun stop()
}
