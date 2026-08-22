package ai.kilocode.client.session.ui.prompt

interface SendPromptContext {
    val isSendEnabled: Boolean
    val isStopEnabled: Boolean
    val isAutoApproveEnabled: Boolean

    fun send()

    fun stop()

    fun toggleAutoApprove()
}
