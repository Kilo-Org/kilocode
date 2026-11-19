package ai.kilocode.backend.v2

import java.io.IOException
import java.net.Proxy
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.channels.trySendBlocking
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources

class V2HttpException(val status: Int, val body: String) : IOException("Kilo API returned HTTP $status")

/** Native v2 HTTP operations. The server's response envelope belongs to the caller. */
class V2Client(baseUrl: String, private val authorization: String) : AutoCloseable {
    private val base = baseUrl.toHttpUrl()
    private val http = OkHttpClient.Builder().proxy(Proxy.NO_PROXY).followRedirects(false).followSslRedirects(false)
        // Model generation requests can outlive OkHttp's default ten-second inactivity timeout.
        .readTimeout(0, TimeUnit.MILLISECONDS).build()
    private val eventSources = EventSources.createFactory(http)

    override fun close() {
        http.dispatcher.cancelAll()
        http.connectionPool.evictAll()
        http.dispatcher.executorService.shutdown()
    }

    suspend fun call(
        operation: String,
        path: Map<String, String> = emptyMap(),
        query: Map<String, String> = emptyMap(),
        body: JsonElement? = null,
    ): JsonElement {
        val op = v2Operations.getValue(operation)
        val payload = body?.toString()?.toRequestBody(jsonType) ?: when (op.method) {
            "POST", "PUT", "PATCH" -> ByteArray(0).toRequestBody()
            else -> null
        }
        val request = request(op, path, query).method(op.method, payload).build()
        return suspendCancellableCoroutine { continuation ->
            val call = http.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) = continuation.resumeWithException(e)

                override fun onResponse(call: Call, response: Response) {
                    continuation.resumeWith(runCatching {
                        response.use {
                            val text = it.body.string()
                            if (!it.isSuccessful) throw V2HttpException(it.code, text)
                            if (text.isEmpty()) JsonNull else Json.parseToJsonElement(text)
                        }
                    })
                }
            })
        }
    }

    /** One subscription; the consumer resnapshots when a new server.connected event arrives. */
    fun events(): Flow<JsonObject> = callbackFlow {
        val request = request(v2Operations.getValue("event.subscribe"), emptyMap(), emptyMap()).build()
        val source = eventSources.newEventSource(request, object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                runCatching { Json.parseToJsonElement(data).jsonObject }.fold(
                    onSuccess = { trySendBlocking(it) },
                    onFailure = { close(it) },
                )
            }

            override fun onClosed(eventSource: EventSource) { close() }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                close(t ?: IOException("Kilo event stream closed (HTTP ${response?.code})"))
            }
        })
        awaitClose { source.cancel() }
    }

    private fun request(op: V2Operation, path: Map<String, String>, query: Map<String, String>): Request.Builder {
        val url = base.newBuilder()
        for (segment in op.route.trim('/').split('/')) {
            val part = if (segment.startsWith('{') && segment.endsWith('}')) {
                path.getValue(segment.substring(1, segment.lastIndex))
            } else segment
            require(part != "." && part != "..") { "Invalid path segment" }
            url.addPathSegment(part)
        }
        query.forEach { (key, value) -> url.addQueryParameter(key, value) }
        return Request.Builder().url(url.build()).header("Authorization", authorization)
    }

    private companion object {
        val jsonType = "application/json; charset=utf-8".toMediaType()
    }
}
