package ai.kilocode.client.plugin

import com.intellij.ide.util.PropertiesComponent

object KiloPluginSettings {
    private const val AUTO_APPROVE_KEY = "kilo.session.autoApprove"
    private const val AUTO_EDITOR_CONTEXT_KEY = "kilo.session.autoEditorContext"
    private const val SHOW_APPROVAL_REASON_KEY = "kilo.session.showApprovalReason"
    private const val PERMISSION_RULES_EXPANDED_KEY = "kilo.session.permissionRulesExpanded"
    private const val WORKTREE_SESSION_LIST_EXPANDED_KEY = "kilo.worktree.sessionListExpanded"

    fun getAutoApprove(): Boolean = PropertiesComponent.getInstance().getBoolean(AUTO_APPROVE_KEY, false)

    fun setAutoApprove(value: Boolean) {
        PropertiesComponent.getInstance().setValue(AUTO_APPROVE_KEY, value.toString())
    }

    internal fun unsetAutoApprove() {
        PropertiesComponent.getInstance().unsetValue(AUTO_APPROVE_KEY)
    }

    fun getAutoEditorContext(): Boolean = PropertiesComponent.getInstance().getBoolean(AUTO_EDITOR_CONTEXT_KEY, true)

    fun setAutoEditorContext(value: Boolean) {
        PropertiesComponent.getInstance().setValue(AUTO_EDITOR_CONTEXT_KEY, value.toString())
    }

    internal fun unsetAutoEditorContext() {
        PropertiesComponent.getInstance().unsetValue(AUTO_EDITOR_CONTEXT_KEY)
    }

    fun getShowApprovalReason(): Boolean = PropertiesComponent.getInstance().getBoolean(SHOW_APPROVAL_REASON_KEY, true)

    fun setShowApprovalReason(value: Boolean) {
        PropertiesComponent.getInstance().setValue(SHOW_APPROVAL_REASON_KEY, value.toString())
    }

    internal fun unsetShowApprovalReason() {
        PropertiesComponent.getInstance().unsetValue(SHOW_APPROVAL_REASON_KEY)
    }

    fun getPermissionRulesExpanded(): Boolean = PropertiesComponent.getInstance().getBoolean(PERMISSION_RULES_EXPANDED_KEY, false)

    fun setPermissionRulesExpanded(value: Boolean) {
        PropertiesComponent.getInstance().setValue(PERMISSION_RULES_EXPANDED_KEY, value.toString())
    }

    internal fun unsetPermissionRulesExpanded() {
        PropertiesComponent.getInstance().unsetValue(PERMISSION_RULES_EXPANDED_KEY)
    }

    fun getWorktreeSessionListExpanded(): Boolean = PropertiesComponent.getInstance().getBoolean(WORKTREE_SESSION_LIST_EXPANDED_KEY, true)

    fun setWorktreeSessionListExpanded(value: Boolean) {
        PropertiesComponent.getInstance().setValue(WORKTREE_SESSION_LIST_EXPANDED_KEY, value.toString())
    }

    internal fun unsetWorktreeSessionListExpanded() {
        PropertiesComponent.getInstance().unsetValue(WORKTREE_SESSION_LIST_EXPANDED_KEY)
    }
}
