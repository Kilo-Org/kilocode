package ai.kilocode.client.testing

import ai.kilocode.rpc.KiloSessionRpcApi
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.CloudSessionDto
import ai.kilocode.rpc.dto.CloudSessionListDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionListDto
import ai.kilocode.rpc.dto.SessionStatusDto
import ai.kilocode.rpc.dto.SessionTimeDto
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Fake [KiloSessionRpcApi] for testing.
 *
 * Configurable return values and call tracking. Push events
 * via [events] and statuses via [statuses].
 *
 * Every `suspend` method asserts it is NOT called on the EDT —
 * RPC calls must happen on background threads.
 */
class FakeSessionRpcApi : KiloSessionRpcApi {

    /** The session returned by [create] and [get]. */
    var session = SessionDto(
        id = "ses_test",
        projectID = "proj_test",
        directory = "/test",
        title = "Test Session",
        version = "1",
        time = SessionTimeDto(created = 0.0, updated = 0.0),
    )

    /** Message history returned by [messages]. */
    val history = mutableListOf<MessageWithPartsDto>()
    var historyGate: CompletableDeferred<Unit>? = null

    /** Recent sessions returned by [recent]. */
    val recent = mutableListOf<SessionDto>()
    var recentFailures = 0
    var recentGate: CompletableDeferred<Unit>? = null

    /** Local sessions returned by [list]. */
    val listed = mutableListOf<SessionDto>()

    /** Cloud sessions returned by [cloudSessions]. */
    val cloud = mutableListOf<CloudSessionDto>()
    var cloudCursor: String? = null
    var importedCloudSession = session

    /** Push chat events here; tests collect from [events]. */
    val events = MutableSharedFlow<ChatEventDto>(extraBufferCapacity = 64, replay = 64)

    /** Push status updates here. */
    val statuses = MutableStateFlow<Map<String, SessionStatusDto>>(emptyMap())

    /** Pending permissions returned by [pendingPermissions]. */
    val pendingPermissionList = mutableListOf<PermissionRequestDto>()

    /** Pending questions returned by [pendingQuestions]. */
    val pendingQuestionList = mutableListOf<QuestionRequestDto>()

    /** Optional custom event stream factory for routing tests. */
    var eventFlow: ((String, String) -> Flow<ChatEventDto>)? = null

    // --- Call tracking ---

    val prompts = mutableListOf<Triple<String, String, PromptDto>>()
    val aborts = mutableListOf<Pair<String, String>>()
    val compacts = mutableListOf<Triple<String, String, ModelSelectionDto>>()
    val configs = mutableListOf<Pair<String, ConfigUpdateDto>>()
    val permissionReplies = mutableListOf<Triple<String, String, PermissionReplyDto>>()
    val permissionRulesSaved = mutableListOf<Triple<String, String, PermissionAlwaysRulesDto>>()
    val questionReplies = mutableListOf<Triple<String, String, QuestionReplyDto>>()
    val questionRejects = mutableListOf<Pair<String, String>>()
    val deletes = mutableListOf<Pair<String, String>>()
    val lists = mutableListOf<String>()
    val recentCalls = mutableListOf<Pair<String, Int>>()
    val cloudCalls = mutableListOf<CloudCall>()
    val imports = mutableListOf<Pair<String, String>>()
    var creates = 0
        private set

    data class CloudCall(val directory: String, val cursor: String?, val limit: Int, val gitUrl: String?)

    // --- Implementation ---

    override suspend fun create(directory: String): SessionDto {
        assertNotEdt("create")
        creates++
        return session
    }

    override suspend fun list(directory: String): SessionListDto {
        assertNotEdt("list")
        lists.add(directory)
        return SessionListDto(listed.toList(), emptyMap())
    }

    override suspend fun recent(directory: String, limit: Int): SessionListDto {
        assertNotEdt("recent")
        recentCalls.add(directory to limit)
        recentGate?.await()
        if (recentFailures > 0) {
            recentFailures--
            throw IllegalStateException("recent unavailable")
        }
        return SessionListDto(recent.take(limit), emptyMap())
    }

    override suspend fun get(id: String, directory: String): SessionDto {
        assertNotEdt("get")
        return session
    }

    override suspend fun delete(id: String, directory: String) {
        assertNotEdt("delete")
        deletes.add(id to directory)
        listed.removeAll { it.id == id }
    }

    override suspend fun cloudSessions(directory: String, cursor: String?, limit: Int, gitUrl: String?): CloudSessionListDto {
        assertNotEdt("cloudSessions")
        cloudCalls.add(CloudCall(directory, cursor, limit, gitUrl))
        return CloudSessionListDto(cloud.take(limit), cloudCursor)
    }

    override suspend fun importCloudSession(id: String, directory: String): SessionDto {
        assertNotEdt("importCloudSession")
        imports.add(id to directory)
        return importedCloudSession
    }

    override suspend fun statuses(): Flow<Map<String, SessionStatusDto>> {
        assertNotEdt("statuses")
        return statuses
    }

    override suspend fun setDirectory(id: String, directory: String) {
        assertNotEdt("setDirectory")
    }

    override suspend fun getDirectory(id: String, fallback: String): String {
        assertNotEdt("getDirectory")
        return fallback
    }

    override suspend fun prompt(id: String, directory: String, prompt: PromptDto) {
        assertNotEdt("prompt")
        prompts.add(Triple(id, directory, prompt))
    }

    override suspend fun abort(id: String, directory: String) {
        assertNotEdt("abort")
        aborts.add(id to directory)
    }

    override suspend fun compact(id: String, directory: String, model: ModelSelectionDto) {
        assertNotEdt("compact")
        compacts.add(Triple(id, directory, model))
    }

    override suspend fun messages(id: String, directory: String): List<MessageWithPartsDto> {
        assertNotEdt("messages")
        historyGate?.await()
        return history.toList()
    }

    override suspend fun events(id: String, directory: String): Flow<ChatEventDto> {
        assertNotEdt("events")
        return eventFlow?.invoke(id, directory) ?: events
    }

    override suspend fun updateConfig(directory: String, config: ConfigUpdateDto) {
        assertNotEdt("updateConfig")
        configs.add(directory to config)
    }

    override suspend fun replyPermission(requestId: String, directory: String, reply: PermissionReplyDto) {
        assertNotEdt("replyPermission")
        permissionReplies.add(Triple(requestId, directory, reply))
    }

    override suspend fun savePermissionRules(requestId: String, directory: String, rules: PermissionAlwaysRulesDto) {
        assertNotEdt("savePermissionRules")
        permissionRulesSaved.add(Triple(requestId, directory, rules))
    }

    override suspend fun replyQuestion(requestId: String, directory: String, answers: QuestionReplyDto) {
        assertNotEdt("replyQuestion")
        questionReplies.add(Triple(requestId, directory, answers))
    }

    override suspend fun rejectQuestion(requestId: String, directory: String) {
        assertNotEdt("rejectQuestion")
        questionRejects.add(requestId to directory)
    }

    override suspend fun pendingPermissions(directory: String): List<PermissionRequestDto> {
        assertNotEdt("pendingPermissions")
        return pendingPermissionList.toList()
    }

    override suspend fun pendingQuestions(directory: String): List<QuestionRequestDto> {
        assertNotEdt("pendingQuestions")
        return pendingQuestionList.toList()
    }
}
