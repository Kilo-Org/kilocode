package ai.kilocode.backend.app

import ai.kilocode.backend.v2.V2Client
import ai.kilocode.rpc.dto.HealthDto
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException

/** One authenticated event stream for all the IDE's projects, chat subscriptions and settings. */
internal class KiloBackendConnectionService {
    private val stream = MutableSharedFlow<JsonObject>(extraBufferCapacity = 64)
    val events = stream.asSharedFlow()

    suspend fun health(client: V2Client): HealthDto {
        val info = client.call("server.info").jsonObject
        return HealthDto(healthy = true, version = info.getValue("version").jsonPrimitive.content)
    }

    /** Connection-scoped loaders are cancelled and joined before the caller can reconnect. */
    suspend fun listen(client: V2Client, connected: suspend () -> Unit): Nothing = coroutineScope {
        val opened = CompletableDeferred<Unit>()
        launch {
            if (withTimeoutOrNull(10_000) { opened.await() } == null) throw IOException("Event stream did not open")
            while (isActive) {
                delay(10_000)
                if (withTimeoutOrNull(5_000) { health(client) } == null) throw IOException("Health check timed out")
            }
        }
        client.events().collect { event ->
            if (event["type"]?.jsonPrimitive?.content == "server.connected" && opened.complete(Unit)) {
                launch(start = CoroutineStart.UNDISPATCHED) { connected() }
            }
            stream.emit(event)
        }
        throw IOException("Event stream disconnected")
    }
}
