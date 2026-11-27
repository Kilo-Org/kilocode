package ai.kilocode.backend.app

import ai.kilocode.backend.cli.KiloBackendCliManager
import ai.kilocode.backend.session.boardDto
import ai.kilocode.backend.session.data
import ai.kilocode.backend.session.fields
import ai.kilocode.backend.session.items
import ai.kilocode.backend.session.jobDto
import ai.kilocode.backend.session.obj
import ai.kilocode.backend.session.sessionDto
import ai.kilocode.backend.session.sessionPath
import ai.kilocode.backend.session.sessionRpc
import ai.kilocode.backend.session.statusDto
import ai.kilocode.backend.session.str
import ai.kilocode.backend.v2.V2Client
import ai.kilocode.backend.v2.V2HttpException
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.BackgroundJobDto
import ai.kilocode.rpc.dto.SessionBoardDto
import ai.kilocode.rpc.dto.SessionChangeDto
import ai.kilocode.rpc.dto.SessionChangeKindDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionListDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.onSubscription
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap

@Service(Service.Level.APP)
class KiloBackendSessionManager(cs: CoroutineScope) {
    private val log = KiloLog.create(javaClass)
    private val directories = ConcurrentHashMap<String, String>()
    private val listed = ConcurrentHashMap.newKeySet<String>()
    private val overrides = ConcurrentHashMap<String, String>()
    private val active = MutableStateFlow<Map<String, SessionStatusDto>>(emptyMap())
    private val updates = MutableSharedFlow<SessionChangeDto>(extraBufferCapacity = 64)
    val statuses = active.asStateFlow()
    val changes = updates.asSharedFlow()

    init {
        cs.launch(start = CoroutineStart.UNDISPATCHED) {
            service<KiloBackendAppService>().events.collect { e ->
                try { observe(e) } catch (e: CancellationException) { throw e }
                catch (e: Exception) { log.warn("Could not refresh session state", e) }
            }
        }
    }

    private suspend fun client() = service<KiloBackendCliManager>().client()
    private fun remember(session: SessionDto) = session.also { directories[it.id] = it.directory }
    fun sessionDirectory(id: String) = overrides[id] ?: directories[id]
    fun getDirectory(id: String, fallback: String) = sessionDirectory(id) ?: fallback
    fun setDirectory(id: String, dir: String) { overrides[id] = dir }

    private suspend fun observe(e: JsonObject) {
        val type = e.str("type")
        if (type == "server.connected") {
            val api = client()
            refreshActive(api)
            // Invalidate once per list, including a previously empty list whose first session arrived while offline.
            val known = directories.entries.associate { it.value to it.key }
            for (dir in listed) {
                val id = known[dir] ?: api.call("session.list", query = mapOf("directory" to dir, "parentID" to "null", "limit" to "1"))
                    .data().jsonArray.firstOrNull()?.jsonObject?.str("id") ?: continue
                updates.emit(SessionChangeDto(id, dir, SessionChangeKindDto.UPDATED))
            }
            return
        }
        val data = e.obj("data") ?: return
        val id = data.str("sessionID") ?: return
        val status = when (type) {
            "session.execution.started" -> SessionStatusDto("busy")
            "session.execution.failed", "session.execution.interrupted", "session.execution.succeeded" -> SessionStatusDto("idle")
            "session.status" -> data.obj("status")?.let(::statusDto)
            "session.retry.scheduled" -> SessionStatusDto("retry", data.obj("error")?.str("message"), data.str("attempt")?.toInt(), data.str("at")?.toLong())
            else -> null
        }
        if (status != null) { active.update { if (status.type == "idle") it - id else it + (id to status) }; return }
        val kind = when (type) {
            "session.created" -> SessionChangeKindDto.CREATED
            "session.deleted" -> SessionChangeKindDto.DELETED
            "session.moved", "session.renamed", "session.archived", "session.unarchived", "session.revert.staged", "session.revert.cleared", "session.revert.committed" -> SessionChangeKindDto.UPDATED
            else -> return
        }
        val oldDir = directories[id]
        val dir = data.obj("location")?.str("directory") ?: oldDir ?: e.obj("location")?.str("directory")
            ?: if (kind != SessionChangeKindDto.DELETED) get(id, "").directory else return
        if (kind == SessionChangeKindDto.DELETED) {
            directories.remove(id); overrides.remove(id); active.update { it - id }
        } else {
            directories[id] = dir
            if (type == "session.moved") {
                overrides.remove(id)
                if (oldDir != null && oldDir != dir) updates.emit(SessionChangeDto(id, oldDir, SessionChangeKindDto.UPDATED))
            }
        }
        updates.emit(SessionChangeDto(id, dir, kind))
    }

    private suspend fun refreshActive(api: V2Client) {
        val previous = active.value
        val snapshot = api.call("session.active").data().jsonObject.keys.associateWith { previous[it] ?: SessionStatusDto("busy") }
        active.compareAndSet(previous, snapshot)
    }

    suspend fun list(dir: String) = listing(dir, null)
    suspend fun recent(dir: String, limit: Int) = listing(dir, limit.coerceAtLeast(0))

    private suspend fun listing(dir: String, limit: Int?): SessionListDto {
        val api = client()
        listed.add(dir)
        refreshActive(api)
        val sessions = mutableListOf<SessionDto>()
        var query = mapOf("directory" to dir, "parentID" to "null", "archived" to "false", "order" to "desc")
        while (limit == null || sessions.size < limit) {
            val page = api.call("session.list", query = query + ("limit" to minOf(100, limit?.minus(sessions.size) ?: 100).toString())).jsonObject
            sessions += page.items("data").map { remember(sessionDto(it.jsonObject)) }
            val next = page.obj("cursor")?.str("next") ?: break
            query = mapOf("cursor" to next)
        }
        val ids = sessions.map { it.id }.toSet()
        return SessionListDto(sessions, statuses.value.filterKeys { it in ids })
    }

    suspend fun create(dir: String) = remember(sessionDto(client().call("session.create", body = buildJsonObject {
        put("location", fields("directory" to dir))
    }).data().jsonObject))

    suspend fun fork(id: String, dir: String, messageId: String? = null): SessionDto {
        val api = client()
        val source = sessionPath(id)
        val fork = try {
            api.call("session.fork", source, body = fields("before" to messageId)).data()
        } catch (e: V2HttpException) {
            if (runCatching { Json.parseToJsonElement(e.body).jsonObject.str("kind") }.getOrNull() != "empty_session") throw e
            val from = api.call("session.get", source).data().jsonObject
            api.call("session.create", body = buildJsonObject {
                put("location", fields("directory" to dir))
                listOf("agent", "title", "model", "metadata", "permissions").forEach { k -> from[k]?.let { put(k, it) } }
            }).data()
        }
        var result = remember(sessionDto(fork.jsonObject))
        val target = withContext(Dispatchers.IO) { Path.of(dir).toRealPath().toString() }
        suspend fun landed() = result.directory == target || withContext(Dispatchers.IO) { Path.of(result.directory).toRealPath().toString() == target }
        if (!landed()) {
            val path = sessionPath(result.id)
            api.call("session.move", path, body = fields("directory" to target))
            withTimeout(15_000) {
                do {
                    result = get(result.id, dir)
                    if (landed() && result.id !in api.call("session.active").data().jsonObject) break
                    delay(100)
                } while (true)
            }
        }
        ForkHandoff.record(api, result.id, result.directory)
        return result
    }

    @Suppress("UNUSED_PARAMETER")
    suspend fun get(id: String, dir: String) = remember(sessionDto(client().call("session.get", sessionPath(id)).data().jsonObject))
    @Suppress("UNUSED_PARAMETER")
    suspend fun delete(id: String, dir: String) { client().call("session.remove", sessionPath(id)) }
    suspend fun rename(id: String, dir: String, title: String): SessionDto {
        client().call("session.update", sessionPath(id), body = fields("title" to title))
        return get(id, dir)
    }

    suspend fun sessionBoard(id: String, dir: String, before: String?, limit: Int?) = boardDto(id, client().sessionRpc("kilocode.board", "get", dir,
        buildJsonObject { put("sessionID", id); before?.let { put("before", it) }; limit?.let { put("limit", it.coerceIn(1, 50)) } }).jsonObject)

    suspend fun resetSessionBoard(id: String, dir: String, revision: Int): SessionBoardDto? = try {
        boardDto(id, client().sessionRpc("kilocode.board", "reset", dir, buildJsonObject { put("sessionID", id); put("revision", revision) }).jsonObject)
    } catch (e: V2HttpException) {
        if (runCatching { Json.parseToJsonElement(e.body).jsonObject.str("type") }.getOrNull() == "conflict") null else throw e
    }

    fun backgroundJobs(id: String, dir: String): Flow<List<BackgroundJobDto>> = service<KiloBackendAppService>().events
        .onSubscription { emit(fields("type" to "server.connected")) }
        .filter { it.str("type") in setOf("server.connected", "plugin.updated") || (it.str("type") == "rpc.kilocode.background-jobs.changed" && it.obj("data")?.str("parentSessionID") == id) }
        .conflate().mapNotNull {
            try {
                client().sessionRpc("kilocode.background-jobs", "list", dir, fields("sessionID" to id)).jsonObject.items("jobs").map { job -> jobDto(job.jsonObject) }
            } catch (e: CancellationException) { throw e }
            catch (e: java.io.IOException) {
                // On a cold location plugins register after requests become available. Reconnect/registration refreshes the list.
                log.debug { "Background jobs snapshot unavailable: ${e.message}" }; null
            }
        }
        .distinctUntilChanged()

    suspend fun cancelBackgroundJob(id: String, dir: String) = jobAction(id, dir, "cancel")
    suspend fun promoteBackgroundJob(id: String, dir: String) = jobAction(id, dir, "promote")
    private suspend fun jobAction(id: String, dir: String, action: String) = client().sessionRpc("kilocode.background-jobs", action, dir, fields("jobID" to id)).jsonPrimitive.boolean
}
