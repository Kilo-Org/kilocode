package ai.kilocode.client.session.ui.prompt

import com.intellij.openapi.actionSystem.DataKey

object PromptDataKeys {
    @JvmField
    val SEND: DataKey<SendPromptContext> =
        DataKey.create("ai.kilocode.client.session.ui.prompt.SendPromptContext")
}
