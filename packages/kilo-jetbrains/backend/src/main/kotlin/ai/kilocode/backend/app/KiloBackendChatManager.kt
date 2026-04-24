package ai.kilocode.backend.app

import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Chat orchestrator that handles message sending, history loading,
 * and SSE event routing for the agent chat UI.
 *
 * **Not an IntelliJ service** — owned by [KiloBackendAppService] which
 * calls [start] after [KiloAppState.Ready] and [stop] on disconnect.
 *
 * All JSON parsing is delegated to [KiloCliDataParser].
 */
class KiloBackendChatManager(
    private val cs: CoroutineScope,
    private val log: KiloLog,
) {
    companion object {
        private val JSON_TYPE = "application/json".toMediaType()

        private val CHAT_EVENTS = setOf(
            "message.updated",
            "message.removed",
            "message.part.updated",
            "message.part.delta",
            "message.part.removed",
            "session.turn.open",
            "session.turn.close",
            "session.error",
            "session.status",
            "session.idle",
            "session.compacted",
            "session.diff",
            "permission.asked",
            "permission.replied",
            "question.asked",
            "question.replied",
            "question.rejected",
            "todo.updated",
        )
    }

    private val _events = MutableSharedFlow<ChatEventDto>(extraBufferCapacity = 128)
    val events: SharedFlow<ChatEventDto> = _events.asSharedFlow()

    private var client: OkHttpClient? = null
    private var base: String? = null
    private var watcher: Job? = null

    fun start(http: OkHttpClient, port: Int, sse: SharedFlow<SseEvent>) {
        client = http
        base = "http://127.0.0.1:$port"
        if (watcher?.isActive == true) return
        watcher = cs.launch {
            sse.collect { event ->
                if (event.type in CHAT_EVENTS) {
                    val parsed = KiloCliDataParser.parseChatEvent(event.type, event.data)
                    if (parsed != null) {
                        log.debug { ChatLogSummary.event(parsed) }
                        _events.emit(parsed)
                    } else {
                        log.warn("SSE parse returned null for type=${event.type} bytes=${event.data.length}")
                    }
                }
            }
        }
        log.info("Chat manager started")
    }

    fun stop() {
        watcher?.cancel()
        watcher = null
        client = null
        base = null
        log.info("Chat manager stopped")
    }

    // ------ prompt ------

    fun prompt(id: String, dir: String, prompt: PromptDto) {
        val meta = if (log.isDebugEnabled) {
            "${ChatLogSummary.dir(dir)} ${ChatLogSummary.prompt(prompt)}"
        } else {
            "kind=prompt parts=${prompt.parts.size}"
        }
        log.info("${ChatLogSummary.sid(id)} kind=prompt $meta op=prompt_async")
        val http = requireClient()
        val url = requireBase()

        val body = KiloCliDataParser.buildPromptJson(prompt)
        val target = "$url/session/$id/prompt_async?directory=${encode(dir)}"
        log.debug { "${ChatLogSummary.sid(id)} ${ChatLogSummary.prompt(prompt)} ${ChatLogSummary.dir(dir)} op=prompt_async send=true" }
        val request = Request.Builder()
            .url(target)
            .post(body.toRequestBody(JSON_TYPE))
            .build()

        try {
            http.newCall(request).execute().use { response ->
                val code = response.code
                if (!response.isSuccessful) {
                    val raw = response.body?.string()
                    log.warn("prompt_async failed: HTTP $code")
                    raw?.let { log.debug { "${ChatLogSummary.sid(id)} kind=prompt op=prompt_async error=${ChatLogSummary.body(it)}" } }
                    throw RuntimeException("prompt_async failed: HTTP $code")
                }
                log.debug { "${ChatLogSummary.sid(id)} kind=prompt op=prompt_async ok=true code=$code" }
            }
        } catch (e: RuntimeException) {
            throw e
        } catch (e: Exception) {
            log.warn("${ChatLogSummary.sid(id)} kind=prompt op=prompt_async dir=${ChatLogSummary.dir(dir)} failed message=${e.message}", e)
            throw RuntimeException("prompt_async HTTP call failed: ${e.message}", e)
        }
    }

    // ------ abort ------

    fun abort(id: String, dir: String) {
        log.debug { "${ChatLogSummary.sid(id)} kind=abort ${ChatLogSummary.dir(dir)} op=abort send=true" }
        val http = requireClient()
        val url = requireBase()

        val request = Request.Builder()
            .url("$url/session/$id/abort?directory=${encode(dir)}")
            .post("".toRequestBody(JSON_TYPE))
            .build()

        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                log.warn("abort failed: HTTP ${response.code}")
                return
            }
            log.debug { "${ChatLogSummary.sid(id)} kind=abort op=abort ok=true code=${response.code}" }
        }
    }

    // ------ messages ------

    fun messages(id: String, dir: String): List<MessageWithPartsDto> {
        val http = requireClient()
        val url = requireBase()
        log.debug { "${ChatLogSummary.sid(id)} kind=history ${ChatLogSummary.dir(dir)} op=messages send=true" }

        val request = Request.Builder()
            .url("$url/session/$id/message?directory=${encode(dir)}")
            .get()
            .build()

        return http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                log.warn("messages failed: HTTP ${response.code}")
                return emptyList()
            }
            val raw = response.body?.string() ?: return emptyList()
            val parsed = KiloCliDataParser.parseMessages(raw)
            log.debug { "${ChatLogSummary.sid(id)} ${ChatLogSummary.history(parsed)} op=messages ok=true code=${response.code}" }
            parsed
        }
    }

    // ------ config update ------

    fun updateConfig(dir: String, update: ConfigUpdateDto) {
        val http = requireClient()
        val url = requireBase()

        val partial = KiloCliDataParser.buildConfigPartial(update)

        val request = Request.Builder()
            .url("$url/global/config")
            .patch(partial.toRequestBody(JSON_TYPE))
            .build()

        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                val msg = response.body?.string() ?: "unknown error"
                log.warn("config update failed: HTTP ${response.code} — $msg")
            } else {
                log.info("Config updated: model=${update.model}, agent=${update.agent}, temp=${update.temperature}")
            }
        }
    }

    // ------ permission / question ------

    fun replyPermission(requestId: String, dir: String, reply: PermissionReplyDto) {
        log.debug { "kind=permission rid=$requestId ${ChatLogSummary.dir(dir)} op=replyPermission reply=${reply.reply} send=true" }
        val body = KiloCliDataParser.buildPermissionReplyJson(reply)
        post("/permission/$requestId/reply?directory=${encode(dir)}", body, "replyPermission", "kind=permission rid=$requestId")
    }

    fun savePermissionRules(requestId: String, dir: String, rules: PermissionAlwaysRulesDto) {
        log.debug { "kind=permission rid=$requestId ${ChatLogSummary.dir(dir)} op=savePermissionRules approved=${rules.approvedAlways.size} denied=${rules.deniedAlways.size} send=true" }
        val body = KiloCliDataParser.buildPermissionAlwaysRulesJson(rules)
        post("/permission/$requestId/always-rules?directory=${encode(dir)}", body, "savePermissionRules", "kind=permission rid=$requestId")
    }

    fun replyQuestion(requestId: String, dir: String, answers: QuestionReplyDto) {
        log.debug { "kind=question rid=$requestId ${ChatLogSummary.dir(dir)} op=replyQuestion answers=${answers.answers.size} send=true" }
        val body = KiloCliDataParser.buildQuestionReplyJson(answers)
        post("/question/$requestId/reply?directory=${encode(dir)}", body, "replyQuestion", "kind=question rid=$requestId")
    }

    fun rejectQuestion(requestId: String, dir: String) {
        log.debug { "kind=question rid=$requestId ${ChatLogSummary.dir(dir)} op=rejectQuestion send=true" }
        post("/question/$requestId/reject?directory=${encode(dir)}", "{}", "rejectQuestion", "kind=question rid=$requestId")
    }

    fun pendingPermissions(dir: String): List<PermissionRequestDto> {
        val raw = get("/permission?directory=${encode(dir)}", "pendingPermissions") ?: return emptyList()
        val parsed = KiloCliDataParser.parsePermissionRequests(raw)
        log.debug { "kind=permission ${ChatLogSummary.dir(dir)} op=pendingPermissions ok=true count=${parsed.size}" }
        return parsed
    }

    fun pendingQuestions(dir: String): List<QuestionRequestDto> {
        val raw = get("/question?directory=${encode(dir)}", "pendingQuestions") ?: return emptyList()
        val parsed = KiloCliDataParser.parseQuestionRequests(raw)
        log.debug { "kind=question ${ChatLogSummary.dir(dir)} op=pendingQuestions ok=true count=${parsed.size}" }
        return parsed
    }

    // ------ utilities ------

    private fun post(path: String, body: String, op: String, meta: String) {
        val http = requireClient()
        val url = requireBase()
        val request = Request.Builder()
            .url("$url$path")
            .post(body.toRequestBody(JSON_TYPE))
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                log.warn("$op failed: HTTP ${response.code}")
                return
            }
            log.debug { "$meta op=$op ok=true code=${response.code}" }
        }
    }

    private fun get(path: String, op: String): String? {
        val http = requireClient()
        val url = requireBase()
        val request = Request.Builder()
            .url("$url$path")
            .get()
            .build()
        return http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                log.warn("$op failed: HTTP ${response.code}")
                null
            } else {
                log.debug { "op=$op ok=true code=${response.code}" }
                response.body?.string()
            }
        }
    }

    private fun requireClient(): OkHttpClient =
        client ?: throw IllegalStateException("Chat manager not started")

    private fun requireBase(): String =
        base ?: throw IllegalStateException("Chat manager not started")

    private fun encode(value: String): String =
        java.net.URLEncoder.encode(value, "UTF-8")
}
