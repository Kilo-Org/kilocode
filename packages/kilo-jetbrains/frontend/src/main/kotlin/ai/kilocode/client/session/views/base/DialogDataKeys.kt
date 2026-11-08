package ai.kilocode.client.session.views.base

import com.intellij.openapi.actionSystem.DataKey

interface DefaultDialogAction {
    val enabled: Boolean
    fun submit()
}

object DialogDataKeys {
    val DEFAULT_ACTION: DataKey<DefaultDialogAction> = DataKey.create("kilo.dialog.defaultAction")
}
