package ai.kilocode.backend.app

import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

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
        private const val ENHANCE_TIMEOUT_MINUTES = 2L

        private val CHAT_EVENTS = setOf(
            "message.updated",
            "message.removed",
            "message.part.updated",
            "message.part.delta",
            "message.part.removed",
            "session.turn.open",
            "session.turn.close",
            "session.created",
            "session.error",
            "session.status",
            "session.updated",
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
    private var normalizer = KiloCliDataParser.ChatEventNormalizer()

    fun start(http: OkHttpClient, port: Int, sse: SharedFlow<SseEvent>) {
        client = http
        base = "http://127.0.0.1:$port"
        if (watcher?.isActive == true) return
        watcher = cs.launch {
            sse.collect { event ->
                if (event.type in CHAT_EVENTS) {
                    val events = try {
                        normalizer.parse(event.type, event.data)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        log.warn(
                            "route=chat-events parse=false type=${event.type} bytes=${event.data.length} ${ChatLogSummary.body(event.data)}",
                            e,
                        )
                        return@collect
                    }
                    if (events != null) {
                        for (parsed in events) {
                            log.debug { ChatLogSummary.event(parsed) }
                            ChatLogSummary.error(parsed)?.let { error ->
                                log.warn(
                                    "route=chat-events emit=true raw=${event.type} bytes=${event.data.length} " +
                                        "subscribers=${_events.subscriptionCount.value} $error",
                                )
                            }
                            if (parsed is ChatEventDto.SessionStatusChanged && parsed.status.type != "busy") {
                                log.info(
                                    "${ChatLogSummary.sid(parsed.sessionID)} kind=status route=chat-events emit=true " +
                                        "${ChatLogSummary.status(parsed.status)} bytes=${event.data.length}",
                                )
                            }
                            _events.emit(parsed)
                        }
                    } else {
                        log.warn("route=chat-events parse=null type=${event.type} bytes=${event.data.length} ${ChatLogSummary.body(event.data)}")
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
        normalizer = KiloCliDataParser.ChatEventNormalizer()
        log.info("Chat manager stopped")
    }

    // ------ prompt ------

    suspend fun enhancePrompt(dir: String, text: String): String {
        val http = requireClient()
        val url = requireBase()
        val body = KiloCliDataParser.buildEnhancePromptJson(text)
        val request = Request.Builder()
            .url("$url/enhance-prompt?directory=${encode(dir)}")
            .post(body.toRequestBody(JSON_TYPE))
            .build()
        val call = http.newCall(request)
        call.timeout().timeout(ENHANCE_TIMEOUT_MINUTES, TimeUnit.MINUTES)

        return call.await().use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                log.warn("enhance prompt failed: HTTP ${response.code}")
                raw.takeIf { it.isNotBlank() }?.let { log.debug { "kind=enhancePrompt error=${ChatLogSummary.body(it)}" } }
                throw RuntimeException("Enhance prompt failed: HTTP ${response.code}")
            }
            KiloCliDataParser.parseEnhancedPrompt(raw)
        }
    }

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
                    val detail = raw?.takeIf { it.isNotBlank() }?.let { ": ${ChatLogSummary.body(it)}" }.orEmpty()
                    throw RuntimeException("prompt_async failed: HTTP $code$detail")
                }
                log.info("${ChatLogSummary.sid(id)} kind=prompt op=prompt_async accepted=true code=$code ${ChatLogSummary.prompt(prompt)}")
                log.debug { "${ChatLogSummary.sid(id)} kind=prompt op=prompt_async ok=true code=$code" }
            }
        } catch (e: RuntimeException) {
            throw e
        } catch (e: Exception) {
            log.warn("${ChatLogSummary.sid(id)} kind=prompt op=prompt_async dir=${ChatLogSummary.dir(dir)} failed message=${e.message}", e)
            throw RuntimeException("prompt_async HTTP call failed: ${e.message}", e)
        }
    }

    fun command(id: String, dir: String, command: String, args: String, prompt: PromptDto) {
        log.info("${ChatLogSummary.sid(id)} kind=command command=$command args=${args.length} parts=${prompt.parts.size}")
        val body = KiloCliDataParser.buildCommandJson(command, args, prompt)
        post("/session/$id/command?directory=${encode(dir)}", body, "command", "${ChatLogSummary.sid(id)} kind=command command=$command")
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

    // ------ compact ------

    fun compact(id: String, dir: String, model: ModelSelectionDto) {
        log.info("${ChatLogSummary.sid(id)} kind=compact ${ChatLogSummary.dir(dir)} model=${model.providerID}/${model.modelID} op=summarize")
        val http = requireClient()
        val url = requireBase()
        val body = KiloCliDataParser.buildSummarizeJson(model)
        val request = Request.Builder()
            .url("$url/session/$id/summarize?directory=${encode(dir)}")
            .post(body.toRequestBody(JSON_TYPE))
            .build()

        try {
            http.newCall(request).execute().use { response ->
                val code = response.code
                if (!response.isSuccessful) {
                    val raw = response.body?.string()
                    log.warn("summarize failed: HTTP $code")
                    raw?.let { log.debug { "${ChatLogSummary.sid(id)} kind=compact op=summarize error=${ChatLogSummary.body(it)}" } }
                    throw RuntimeException("summarize failed: HTTP $code")
                }
                log.debug { "${ChatLogSummary.sid(id)} kind=compact op=summarize ok=true code=$code" }
            }
        } catch (e: RuntimeException) {
            throw e
        } catch (e: Exception) {
            log.warn("${ChatLogSummary.sid(id)} kind=compact op=summarize dir=${ChatLogSummary.dir(dir)} failed message=${e.message}", e)
            throw RuntimeException("summarize HTTP call failed: ${e.message}", e)
        }
    }

    // ------ revert ------

    fun revert(id: String, dir: String, messageID: String, partID: String?): SessionDto {
        log.info("${ChatLogSummary.sid(id)} kind=revert ${ChatLogSummary.dir(dir)} msg=$messageID op=revert")
        val http = requireClient()
        val url = requireBase()
        val body = KiloCliDataParser.buildRevertJson(messageID, partID)
        val request = Request.Builder()
            .url("$url/session/$id/revert?directory=${encode(dir)}")
            .post(body.toRequestBody(JSON_TYPE))
            .build()

        try {
            http.newCall(request).execute().use { response ->
                val code = response.code
                val raw = response.body?.string()
                if (!response.isSuccessful) {
                    log.warn("revert failed: HTTP $code")
                    raw?.let { log.debug { "${ChatLogSummary.sid(id)} kind=revert op=revert error=${ChatLogSummary.body(it)}" } }
                    throw RuntimeException("revert failed: HTTP $code")
                }
                log.debug { "${ChatLogSummary.sid(id)} kind=revert op=revert ok=true code=$code" }
                return KiloCliDataParser.parseSession(raw ?: throw RuntimeException("revert response missing body"))
            }
        } catch (e: RuntimeException) {
            throw e
        } catch (e: Exception) {
            log.warn("${ChatLogSummary.sid(id)} kind=revert op=revert dir=${ChatLogSummary.dir(dir)} failed message=${e.message}", e)
            throw RuntimeException("revert HTTP call failed: ${e.message}", e)
        }
    }

    fun unrevert(id: String, dir: String): SessionDto {
        log.info("${ChatLogSummary.sid(id)} kind=unrevert ${ChatLogSummary.dir(dir)} op=unrevert")
        val http = requireClient()
        val url = requireBase()
        val request = Request.Builder()
            .url("$url/session/$id/unrevert?directory=${encode(dir)}")
            .post("".toRequestBody(JSON_TYPE))
            .build()

        try {
            http.newCall(request).execute().use { response ->
                val code = response.code
                val raw = response.body?.string()
                if (!response.isSuccessful) {
                    log.warn("unrevert failed: HTTP $code")
                    raw?.let { log.debug { "${ChatLogSummary.sid(id)} kind=unrevert op=unrevert error=${ChatLogSummary.body(it)}" } }
                    throw RuntimeException("unrevert failed: HTTP $code")
                }
                log.debug { "${ChatLogSummary.sid(id)} kind=unrevert op=unrevert ok=true code=$code" }
                return KiloCliDataParser.parseSession(raw ?: throw RuntimeException("unrevert response missing body"))
            }
        } catch (e: RuntimeException) {
            throw e
        } catch (e: Exception) {
            log.warn("${ChatLogSummary.sid(id)} kind=unrevert op=unrevert dir=${ChatLogSummary.dir(dir)} failed message=${e.message}", e)
            throw RuntimeException("unrevert HTTP call failed: ${e.message}", e)
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

    fun attachmentPart(id: String, dir: String, message: String, part: String, key: String?): PartDto? {
        return messages(id, dir)
            .firstOrNull { it.info.id == message }
            ?.parts
            ?.firstOrNull {
                if (it.type != "file") return@firstOrNull false
                if (!key.isNullOrBlank()) attachmentKey(it.id, it.filename.orEmpty(), it.url.orEmpty()) == key
                else it.id == part
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

    private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { cancel() }
        enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (!cont.isCancelled) cont.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                cont.resume(response) { _, value, _ -> value.close() }
            }
        })
    }

    private fun encode(value: String): String =
        java.net.URLEncoder.encode(value, "UTF-8")

    private fun attachmentKey(part: String, name: String, url: String): String {
        val value = listOf(part, name, url).joinToString("\u0000")
        val bytes = java.security.MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return bytes.take(16).joinToString("") { "%02x".format(it) }
    }
}
