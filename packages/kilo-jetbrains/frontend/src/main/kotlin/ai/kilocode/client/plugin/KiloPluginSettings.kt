package ai.kilocode.client.plugin

import com.intellij.ide.util.PropertiesComponent

object KiloPluginSettings {
    private const val AUTO_APPROVE_KEY = "kilo.session.autoApprove"
    private const val AUTO_EDITOR_CONTEXT_KEY = "kilo.session.autoEditorContext"
    private const val SHOW_APPROVAL_REASON_KEY = "kilo.session.showApprovalReason"
    private const val PERMISSION_RULES_EXPANDED_KEY = "kilo.session.permissionRulesExpanded"
    private const val GITHUB_KEY = "kilo.integrations.github"
    private const val AGENT_KEY = "kilo.session.agent"
    private const val COMPACT_MODE_KEY = "kilo.session.compactMode"
    private const val COMPACT_GROUP_READS_KEY = "kilo.session.compact.groupReads"
    private const val COMPACT_GROUP_WRITES_KEY = "kilo.session.compact.groupWrites"
    private const val COMPACT_GROUP_WEB_KEY = "kilo.session.compact.groupWeb"
    private const val COMPACT_GROUP_SUBAGENTS_KEY = "kilo.session.compact.groupSubagents"
    private const val COMPACT_GROUP_OTHER_KEY = "kilo.session.compact.groupOther"

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

    /**
     * Master switch for the transcript's compact mode: consecutive groupable tool cards collapse
     * into one summary card. IDE-level, like [getShowApprovalReason] — never sent to the CLI.
     */
    fun getCompactMode(): Boolean = PropertiesComponent.getInstance().getBoolean(COMPACT_MODE_KEY, false)

    fun setCompactMode(value: Boolean) {
        PropertiesComponent.getInstance().setValue(COMPACT_MODE_KEY, value.toString())
    }

    internal fun unsetCompactMode() {
        PropertiesComponent.getInstance().unsetValue(COMPACT_MODE_KEY)
    }

    fun getCompactGroupReads(): Boolean = PropertiesComponent.getInstance().getBoolean(COMPACT_GROUP_READS_KEY, true)

    fun setCompactGroupReads(value: Boolean) {
        PropertiesComponent.getInstance().setValue(COMPACT_GROUP_READS_KEY, value.toString())
    }

    internal fun unsetCompactGroupReads() {
        PropertiesComponent.getInstance().unsetValue(COMPACT_GROUP_READS_KEY)
    }

    fun getCompactGroupWrites(): Boolean = PropertiesComponent.getInstance().getBoolean(COMPACT_GROUP_WRITES_KEY, true)

    fun setCompactGroupWrites(value: Boolean) {
        PropertiesComponent.getInstance().setValue(COMPACT_GROUP_WRITES_KEY, value.toString())
    }

    internal fun unsetCompactGroupWrites() {
        PropertiesComponent.getInstance().unsetValue(COMPACT_GROUP_WRITES_KEY)
    }

    fun getCompactGroupWeb(): Boolean = PropertiesComponent.getInstance().getBoolean(COMPACT_GROUP_WEB_KEY, true)

    fun setCompactGroupWeb(value: Boolean) {
        PropertiesComponent.getInstance().setValue(COMPACT_GROUP_WEB_KEY, value.toString())
    }

    internal fun unsetCompactGroupWeb() {
        PropertiesComponent.getInstance().unsetValue(COMPACT_GROUP_WEB_KEY)
    }

    fun getCompactGroupSubagents(): Boolean = PropertiesComponent.getInstance().getBoolean(COMPACT_GROUP_SUBAGENTS_KEY, true)

    fun setCompactGroupSubagents(value: Boolean) {
        PropertiesComponent.getInstance().setValue(COMPACT_GROUP_SUBAGENTS_KEY, value.toString())
    }

    internal fun unsetCompactGroupSubagents() {
        PropertiesComponent.getInstance().unsetValue(COMPACT_GROUP_SUBAGENTS_KEY)
    }

    /** Shell commands, MCP tools, skills, lsp, and anything else with no dedicated category. */
    fun getCompactGroupOther(): Boolean = PropertiesComponent.getInstance().getBoolean(COMPACT_GROUP_OTHER_KEY, true)

    fun setCompactGroupOther(value: Boolean) {
        PropertiesComponent.getInstance().setValue(COMPACT_GROUP_OTHER_KEY, value.toString())
    }

    internal fun unsetCompactGroupOther() {
        PropertiesComponent.getInstance().unsetValue(COMPACT_GROUP_OTHER_KEY)
    }
}
