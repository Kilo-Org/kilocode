package ai.kilocode.client.plugin

import com.intellij.ide.util.PropertiesComponent

object KiloPluginSettings {
    private const val AUTO_APPROVE_KEY = "kilo.session.autoApprove"
    private const val PERMISSION_RULES_EXPANDED_KEY = "kilo.session.permissionRulesExpanded"

    fun getAutoApprove(): Boolean = PropertiesComponent.getInstance().getBoolean(AUTO_APPROVE_KEY, false)

    fun setAutoApprove(value: Boolean) {
        PropertiesComponent.getInstance().setValue(AUTO_APPROVE_KEY, value.toString())
    }

    internal fun unsetAutoApprove() {
        PropertiesComponent.getInstance().unsetValue(AUTO_APPROVE_KEY)
    }

    fun getPermissionRulesExpanded(): Boolean = PropertiesComponent.getInstance().getBoolean(PERMISSION_RULES_EXPANDED_KEY, false)

    fun setPermissionRulesExpanded(value: Boolean) {
        PropertiesComponent.getInstance().setValue(PERMISSION_RULES_EXPANDED_KEY, value.toString())
    }

    internal fun unsetPermissionRulesExpanded() {
        PropertiesComponent.getInstance().unsetValue(PERMISSION_RULES_EXPANDED_KEY)
    }
}
