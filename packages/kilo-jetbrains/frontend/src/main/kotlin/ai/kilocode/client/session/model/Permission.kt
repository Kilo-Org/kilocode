package ai.kilocode.client.session.model

enum class PermissionRequestState { PENDING, RESPONDING, RESOLVED, ERROR }

enum class PermissionReply { ONCE, ALWAYS, REJECT }

enum class PermissionRuleDecision { APPROVED, DENIED, PENDING }

data class Permission(
    val id: String,
    val sessionId: String,
    val name: String,
    val patterns: List<String>,
    val always: List<String>,
    val meta: PermissionMeta,
    val message: String? = null,
    val tool: ToolCallRef? = null,
    val state: PermissionRequestState = PermissionRequestState.PENDING,
)

data class PermissionMeta(
    val command: String? = null,
    val rules: List<String> = emptyList(),
    val ruleDecisions: List<PermissionRuleCandidate> = emptyList(),
    val diff: String? = null,
    val filePath: String? = null,
    val fileDiff: PermissionFileDiff? = null,
    val fileDiffs: List<PermissionFileDiff> = emptyList(),
    val raw: Map<String, String> = emptyMap(),
)

data class PermissionRuleCandidate(
    val pattern: String,
    val decision: PermissionRuleDecision = PermissionRuleDecision.PENDING,
    val defaultDecision: PermissionRuleDecision = decision,
)

data class PermissionFileDiff(
    val file: String,
    val patch: String? = null,
    val before: String? = null,
    val after: String? = null,
    val additions: Int,
    val deletions: Int,
)
