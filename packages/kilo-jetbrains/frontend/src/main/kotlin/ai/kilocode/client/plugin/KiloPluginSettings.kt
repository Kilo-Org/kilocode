package ai.kilocode.client.plugin

import ai.kilocode.client.session.settings.BlockDisplay
import ai.kilocode.client.session.settings.ReasoningDisplay
import com.intellij.ide.util.PropertiesComponent

object KiloPluginSettings {
    private const val AUTO_APPROVE_KEY = "kilo.session.autoApprove"
    private const val AUTO_EDITOR_CONTEXT_KEY = "kilo.session.autoEditorContext"
    private const val SHOW_APPROVAL_REASON_KEY = "kilo.session.showApprovalReason"
    private const val PERMISSION_RULES_EXPANDED_KEY = "kilo.session.permissionRulesExpanded"
    private const val GITHUB_KEY = "kilo.integrations.github"
    private const val AGENT_KEY = "kilo.session.agent"
    private const val REASONING_DISPLAY_KEY = "kilo.session.reasoningDisplay"
    private const val TERMINAL_COMMAND_DISPLAY_KEY = "kilo.session.terminalCommandDisplay"
    private const val CODE_EDIT_DISPLAY_KEY = "kilo.session.codeEditDisplay"
    private const val MCP_TOOL_DISPLAY_KEY = "kilo.session.mcpToolDisplay"
    private const val HOVER_PREVIEW_KEY = "kilo.session.hoverPreview"

    /**
     * Mode the prompt picker last selected, or null when the CLI's own default should win.
     *
     * IDE-local on purpose. This used to be written to the CLI's global config as `default_agent`,
     * which made the CLI dispose every instance it held and cancel every running turn in every
     * worktree — a mode switch is a UI preference, not a server reconfiguration. The picked mode
     * still travels with each prompt, so nothing here reaches the server.
     */
    fun getAgent(): String? = PropertiesComponent.getInstance().getValue(AGENT_KEY)?.takeIf { it.isNotBlank() }

    fun setAgent(value: String) {
        PropertiesComponent.getInstance().setValue(AGENT_KEY, value)
    }

    internal fun unsetAgent() {
        PropertiesComponent.getInstance().unsetValue(AGENT_KEY)
    }

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

    fun getGithub(): Boolean = PropertiesComponent.getInstance().getBoolean(GITHUB_KEY, true)

    fun setGithub(value: Boolean) {
        PropertiesComponent.getInstance().setValue(GITHUB_KEY, value.toString())
    }

    internal fun unsetGithub() {
        PropertiesComponent.getInstance().unsetValue(GITHUB_KEY)
    }

    fun getReasoningDisplay(): ReasoningDisplay {
        val raw = PropertiesComponent.getInstance().getValue(REASONING_DISPLAY_KEY)
        return ReasoningDisplay.entries.firstOrNull { it.storageKey == raw } ?: ReasoningDisplay.EXPANDED
    }

    fun setReasoningDisplay(value: ReasoningDisplay) {
        PropertiesComponent.getInstance().setValue(REASONING_DISPLAY_KEY, value.storageKey)
    }

    internal fun unsetReasoningDisplay() {
        PropertiesComponent.getInstance().unsetValue(REASONING_DISPLAY_KEY)
    }

    fun getTerminalCommandDisplay(): BlockDisplay = blockDisplay(TERMINAL_COMMAND_DISPLAY_KEY, BlockDisplay.EXPANDED)

    fun setTerminalCommandDisplay(value: BlockDisplay) {
        PropertiesComponent.getInstance().setValue(TERMINAL_COMMAND_DISPLAY_KEY, value.storageKey)
    }

    internal fun unsetTerminalCommandDisplay() {
        PropertiesComponent.getInstance().unsetValue(TERMINAL_COMMAND_DISPLAY_KEY)
    }

    fun getCodeEditDisplay(): BlockDisplay = blockDisplay(CODE_EDIT_DISPLAY_KEY, BlockDisplay.COLLAPSED)

    fun setCodeEditDisplay(value: BlockDisplay) {
        PropertiesComponent.getInstance().setValue(CODE_EDIT_DISPLAY_KEY, value.storageKey)
    }

    internal fun unsetCodeEditDisplay() {
        PropertiesComponent.getInstance().unsetValue(CODE_EDIT_DISPLAY_KEY)
    }

    fun getMcpToolDisplay(): BlockDisplay = blockDisplay(MCP_TOOL_DISPLAY_KEY, BlockDisplay.COLLAPSED)

    fun setMcpToolDisplay(value: BlockDisplay) {
        PropertiesComponent.getInstance().setValue(MCP_TOOL_DISPLAY_KEY, value.storageKey)
    }

    internal fun unsetMcpToolDisplay() {
        PropertiesComponent.getInstance().unsetValue(MCP_TOOL_DISPLAY_KEY)
    }

    fun getHoverPreview(): Boolean = PropertiesComponent.getInstance().getBoolean(HOVER_PREVIEW_KEY, true)

    fun setHoverPreview(value: Boolean) {
        PropertiesComponent.getInstance().setValue(HOVER_PREVIEW_KEY, value.toString())
    }

    internal fun unsetHoverPreview() {
        PropertiesComponent.getInstance().unsetValue(HOVER_PREVIEW_KEY)
    }

    private fun blockDisplay(key: String, default: BlockDisplay): BlockDisplay {
        val raw = PropertiesComponent.getInstance().getValue(key)
        return BlockDisplay.entries.firstOrNull { it.storageKey == raw } ?: default
    }
}
