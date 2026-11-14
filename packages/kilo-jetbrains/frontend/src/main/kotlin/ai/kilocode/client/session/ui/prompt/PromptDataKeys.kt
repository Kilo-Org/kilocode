package ai.kilocode.client.session.ui.prompt

import com.intellij.openapi.actionSystem.DataKey

object PromptDataKeys {
    @JvmField
    val SEND: DataKey<SendPromptContext> =
        DataKey.create("ai.kilocode.client.session.ui.prompt.SendPromptContext")

    @JvmField
    val SPEECH: DataKey<SpeechInputContext> =
        DataKey.create("ai.kilocode.client.session.ui.prompt.SpeechInputContext")

    @JvmField
    val SELECTORS: DataKey<PromptSelectors> =
        DataKey.create("ai.kilocode.client.session.ui.prompt.PromptSelectors")
}
