package ai.kilocode.backend.app

import ai.kilocode.backend.cli.IdeLspRequestInfo
import ai.kilocode.backend.cli.IdeLspResultInfo
import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.backend.ideintel.CodeIntelFailure
import ai.kilocode.backend.ideintel.KiloPsiCodeIntel
import ai.kilocode.log.KiloLog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap

class KiloBackendIdeLspManager(
    private val cs: CoroutineScope,
    private val log: KiloLog,
) {
    private val active = ConcurrentHashMap<String, Job>()
    private val dirs = ConcurrentHashMap.newKeySet<String>()
    private var client: OkHttpClient? = null
    private var base: String? = null
    private var watcher: Job? = null

    fun start(http: OkHttpClient, port: Int, sse: SharedFlow<SseEvent>) {
        stop()
        client = http
        base = "http://127.0.0.1:$port"
        dirs.forEach { dir -> cs.launch { drain(dir) } }
        watcher = cs.launch {
            sse.collect { event ->
                when (event.type) {
                    "kilocode.ideLsp.requested" -> {
                        val dir = KiloCliDataParser.extractDirectory(event.data) ?: return@collect
                        dirs.add(dir)
                        drain(dir)
                    }
                    "kilocode.ideLsp.cancelled" -> {
                        val id = KiloCliDataParser.parseIdeLspRequestId(event.data) ?: return@collect
                        active.remove(id)?.cancel()
                    }
                }
            }
        }
    }

    fun stop() {
        watcher?.cancel()
        watcher = null
        active.values.forEach { it.cancel() }
        active.clear()
        client = null
        base = null
    }

    private suspend fun drain(dir: String) {
        val requests = runCatching { list(dir) }.getOrElse { err ->
            log.warn("IDE code intelligence request list failed for $dir: ${err.message}", err)
            return
        }
        for (request in requests) {
            active.computeIfAbsent(request.id) {
                cs.launch(Dispatchers.Default) {
                    try {
                        handle(dir, request)
                    } finally {
                        active.remove(request.id)
                    }
                }
            }
        }
    }

    private suspend fun list(dir: String): List<IdeLspRequestInfo> = withContext(Dispatchers.IO) {
        val http = client ?: return@withContext emptyList()
        val url = "${base ?: return@withContext emptyList()}/kilocode/ide-lsp?directory=${encode(dir)}"
        val request = Request.Builder().url(url).get().build()
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IllegalStateException("HTTP ${response.code}: $body")
            KiloCliDataParser.parseIdeLspRequests(body)
        }
    }

    private suspend fun handle(dir: String, request: IdeLspRequestInfo) {
        try {
            val result = KiloPsiCodeIntel.handle(dir, request)
            reply(dir, request.id, result)
        } catch (e: CancellationException) {
            throw e
        } catch (e: CodeIntelFailure) {
            reject(dir, request.id, e.code, e.message)
        } catch (e: Exception) {
            log.warn("IDE code intelligence request failed for ${request.operation}: ${e.message}", e)
            reject(dir, request.id, "not_found", e.message ?: "IDE code intelligence request failed")
        }
    }

    private suspend fun reply(dir: String, id: String, result: IdeLspResultInfo) = post(
        path = "/kilocode/ide-lsp/$id/reply?directory=${encode(dir)}",
        body = KiloCliDataParser.buildIdeLspReplyJson(result),
    )

    private suspend fun reject(dir: String, id: String, code: String, message: String) = post(
        path = "/kilocode/ide-lsp/$id/reject?directory=${encode(dir)}",
        body = KiloCliDataParser.buildIdeLspRejectJson(code, message),
    )

    private suspend fun post(path: String, body: String) = withContext(Dispatchers.IO) {
        val http = client ?: return@withContext
        val url = "${base ?: return@withContext}$path"
        val request = Request.Builder()
            .url(url)
            .post(body.toRequestBody(JSON))
            .build()
        http.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IllegalStateException("HTTP ${response.code}: $text")
        }
    }

    private fun encode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8)

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
