package ai.kilocode.client.plugin

import com.intellij.ide.util.PropertiesComponent

object KiloPluginSettings {
    private const val AUTO_APPROVE_KEY = "kilo.session.autoApprove"

    fun getAutoApprove(): Boolean = PropertiesComponent.getInstance().getBoolean(AUTO_APPROVE_KEY, false)

    fun setAutoApprove(value: Boolean) {
        PropertiesComponent.getInstance().setValue(AUTO_APPROVE_KEY, value.toString())
    }

    internal fun unsetAutoApprove() {
        PropertiesComponent.getInstance().unsetValue(AUTO_APPROVE_KEY)
    }
}
