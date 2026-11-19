package ai.kilocode.backend.app

import ai.kilocode.backend.cli.KiloBackendCliManager
import ai.kilocode.backend.session.SessionFeed
import ai.kilocode.backend.session.SessionRequests
import ai.kilocode.backend.session.SessionTranscript
import ai.kilocode.backend.session.activityEvents
import ai.kilocode.backend.session.data
import ai.kilocode.backend.session.diffDto
import ai.kilocode.backend.session.fields
import ai.kilocode.backend.session.history
import ai.kilocode.backend.session.obj
import ai.kilocode.backend.session.promptBody
import ai.kilocode.backend.session.required
import ai.kilocode.backend.session.sessionPath
import ai.kilocode.backend.session.str
import ai.kilocode.backend.v2.V2Client
import ai.kilocode.backend.workspace.KiloWorkspaceData
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PromptDto
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.onSubscription
import kotlinx.coroutines.flow.shareIn
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.security.MessageDigest

@Service(Service.Level.APP)
class KiloBackendChatManager(private val cs: CoroutineScope) {
    private val log = KiloLog.create(javaClass)
    private val interrupts = MutableSharedFlow<ChatEventDto.SessionInterrupted>()
    private val raw get() = service<KiloBackendAppService>().events
    internal val requests = SessionRequests(::client)
    private suspend fun client() = service<KiloBackendCliManager>().client()

    /** Cross-session activity is light: unopened sessions do not load transcripts. */
    val events: SharedFlow<ChatEventDto> = merge(flow<ChatEventDto> {
        raw.collect { e ->
            val data = e.obj("data") ?: return@collect
            val events = try { activityEvents(e.required("type"), data) }
                catch (error: CancellationException) { throw error }
                catch (error: RuntimeException) { log.warn("Invalid activity event ${e.str("type")}", error); return@collect }
            for (event in events) emit(event)
        }
    }, interrupts).shareIn(cs, SharingStarted.WhileSubscribed(), replay = 0)

    fun observe(id: String): Flow<ChatEventDto> = merge(flow<ChatEventDto> {
        val feed = SessionFeed(id, ::client)
        raw.onSubscription { emit(fields("type" to "server.connected")) }.collect { e ->
            val batch = try { feed.receive(e) } catch (error: CancellationException) { throw error }
                catch (error: Exception) { log.warn("Chat update failed for ${e.str("type")}", error); emptyList() }
            batch.forEach { emit(it) }
        }
    }, interrupts.filter { it.sessionID == id })

    fun interrupt(ids: Collection<String>, reason: String) { cs.launch { ids.forEach { interrupts.emit(ChatEventDto.SessionInterrupted(it, reason)) } } }

    private suspend fun select(api: V2Client, id: String, prompt: PromptDto) {
        val path = sessionPath(id)
        val info = api.call("session.get", path).data().jsonObject
        // A session created while location plugins are still loading can have no agent yet.
        val previous = info.str("agent")
        val agent = prompt.agent?.takeIf { it.isNotBlank() } ?: previous?.takeIf { it.isNotBlank() }
            ?: KiloWorkspaceData(api, info.obj("location")?.required("directory")).agents().default
        require(agent.isNotBlank()) { "The workspace has no primary agent available yet." }
        if (agent != previous) api.call("session.switchAgent", path, body = fields("agent" to agent))
        if (prompt.providerID != null && prompt.modelID != null) {
            val model = fields("id" to prompt.modelID, "providerID" to prompt.providerID, "variant" to prompt.variant)
            if (model != info.obj("model")) api.call("session.switchModel", path, body = buildJsonObject { put("model", model) })
        }
    }

    suspend fun prompt(id: String, prompt: PromptDto) {
        val api = client()
        if (prompt.parts.isNotEmpty() && prompt.parts.all { it.synthetic == true && it.type == "text" }) {
            api.call("session.synthetic", sessionPath(id), body = buildJsonObject {
                put("text", prompt.parts.mapNotNull { it.text }.joinToString("\n")); put("resume", prompt.noReply != true)
                prompt.messageID?.let { put("id", it) }
            }); return
        }
        select(api, id, prompt)
        api.call("session.prompt", sessionPath(id), body = promptBody(prompt))
    }
    suspend fun command(id: String, name: String, arguments: String, prompt: PromptDto) {
        val api = client(); select(api, id, prompt)
        api.call("session.command", sessionPath(id), body = promptBody(prompt, name, arguments))
    }
    suspend fun abort(id: String) { client().call("session.interrupt", sessionPath(id)) }
    suspend fun compact(id: String, model: ModelSelectionDto) {
        val api = client(); select(api, id, PromptDto(emptyList(), providerID = model.providerID, modelID = model.modelID))
        api.call("session.compact", sessionPath(id), body = fields())
    }
    suspend fun revert(id: String, message: String) { client().call("session.revert.stage", sessionPath(id), body = buildJsonObject { put("messageID", message); put("files", true) }) }
    suspend fun deleteMessage(id: String, message: String): Boolean {
        val api = client(); val path = sessionPath(id)
        val exists = api.call("session.inbox.list", path).data().jsonArray.any { it.jsonObject.str("id") == message && it.jsonObject.str("type") == "user" }
        if (exists) api.call("session.inbox.cancel", path + ("inboxID" to message))
        return exists
    }
    suspend fun unrevert(id: String) { client().call("session.revert.clear", sessionPath(id)) }
    suspend fun messages(id: String) = history(client(), id, summaries = true)

    suspend fun attachmentPart(id: String, message: String, part: String, key: String?): PartDto? {
        val m = client().call("session.message.get", sessionPath(id) + ("messageID" to message)).data().jsonObject
        return SessionTranscript(id).message(m)?.parts?.firstOrNull { p -> p.type == "file" && if (key.isNullOrBlank()) p.id == part else {
            val bytes = listOf(p.id, p.filename.orEmpty(), p.url.orEmpty()).joinToString("\u0000").toByteArray(Charsets.UTF_8)
            MessageDigest.getInstance("SHA-256").digest(bytes).take(16).joinToString("") { "%02x".format(it) } == key
        } }
    }

    suspend fun diff(id: String, message: String? = null, full: Boolean = false): List<DiffFileDto> {
        val api = client(); val path = sessionPath(id)
        val range = if (message == null) {
            suspend fun edge(order: String) = api.call("session.message.list", path, mapOf("type" to "user", "order" to order, "limit" to "1"))
                .data().jsonArray.firstOrNull()?.jsonObject?.str("id")
            val first = edge("asc") ?: return emptyList()
            mapOf("from" to first, "to" to (edge("desc") ?: first))
        } else {
            val m = api.call("session.message.get", path + ("messageID" to message)).data().jsonObject
            val user = if (m.str("type") == "user") message else history(api, id).firstOrNull { it.info.id == message }?.info?.parentID ?: return emptyList()
            mapOf("from" to user)
        }
        val query = if (full) range else range + ("context" to "3")
        return api.call("session.diff", path, query).data().jsonArray.map { diffDto(it.jsonObject) }
    }
}
