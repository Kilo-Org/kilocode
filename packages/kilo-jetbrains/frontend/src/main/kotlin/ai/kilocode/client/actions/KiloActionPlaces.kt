package ai.kilocode.client.actions

import com.intellij.openapi.actionSystem.ActionPlaces

internal object KiloActionPlaces {
    const val CONNECTION_RETRY = "Kilo.ConnectionRetry"

    fun connectionRetryPopup() = ActionPlaces.getActionGroupPopupPlace(CONNECTION_RETRY)
}
