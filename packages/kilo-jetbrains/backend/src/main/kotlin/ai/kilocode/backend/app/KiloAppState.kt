package ai.kilocode.backend.app

import ai.kilocode.backend.v2.V2Client
import ai.kilocode.backend.v2.V2HttpException
import ai.kilocode.backend.workspace.KiloWorkspaceData
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.LoadErrorDto
import ai.kilocode.rpc.dto.LoadProgressDto
import ai.kilocode.rpc.dto.ProfileStatusDto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Wait on the client side: a cold Location initially exposes a partial plugin inventory. */
internal suspend fun installed(client: V2Client): Set<String> = client.call("plugin.list")
    .jsonObject.getValue("data").jsonArray.mapNotNull { value ->
        val plugin = value.jsonObject
        plugin["id"]?.jsonPrimitive?.content?.takeIf {
            (plugin["state"] as? JsonObject)?.get("status")?.jsonPrimitive?.content == "active"
        }
    }.toSet()

internal class KiloAppState(val flow: MutableStateFlow<KiloAppStateDto>) {
    suspend fun load(client: V2Client) {
        flow.value = KiloAppStateDto(KiloAppStatusDto.LOADING, progress = LoadProgressDto())
        try {
            val ready = withTimeoutOrNull(30_000) {
                var plugins = installed(client)
                while ("kilocode.settings" !in plugins || "kilocode.gateway" !in plugins) {
                    delay(150)
                    plugins = installed(client)
                }
                snapshot(client, plugins)
            }
            flow.value = ready ?: failure("app", IllegalStateException("Timed out loading app data"))
        } catch (e: CancellationException) {
            throw e
        } catch (e: ResourceFailure) {
            flow.value = failure(e.resource, e.cause)
        } catch (e: Exception) {
            flow.value = failure("app", e)
        }
    }

    private suspend fun snapshot(client: V2Client, plugins: Set<String>): KiloAppStateDto = coroutineScope {
        val account = KiloAccountSettings { client }
        val config = async {
            fetch("config") { KiloWorkspaceData(client).config() }.also { progress { copy(config = true) } }
        }
        val profile = async {
            fetch("profile", attempts = 1) {
                try {
                    account.profile()
                } catch (e: V2HttpException) {
                    if (e.status != 400 && e.status != 401 && e.status !in 500..599) throw e
                    null
                }
            }.also {
                val status = if (it == null) ProfileStatusDto.NOT_LOGGED_IN else ProfileStatusDto.LOADED
                progress { copy(profile = status) }
            }
        }
        fetch("notifications") { account.notifications() }
        progress { copy(notifications = true) }
        val cfg = config.await()
        val user = profile.await()
        KiloAppStateDto(
            KiloAppStatusDto.READY, config = cfg, profile = user, progress = flow.value.progress,
            backgroundSubagents = "kilocode.background-jobs" in plugins,
        )
    }

    private fun progress(update: LoadProgressDto.() -> LoadProgressDto) = flow.update {
        it.copy(progress = (it.progress ?: LoadProgressDto()).update())
    }

    private suspend fun <T> fetch(resource: String, attempts: Int = 3, block: suspend () -> T): T {
        for (attempt in 1 until attempts) {
            try {
                return block()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                delay(1_000)
            }
        }
        try {
            return block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw ResourceFailure(resource, e)
        }
    }
}

private class ResourceFailure(val resource: String, override val cause: Exception) : Exception(cause)

internal fun failure(resource: String, cause: Exception): KiloAppStateDto {
    val status = (cause as? V2HttpException)?.status
    val detail = if (status != null) "HTTP $status" else cause.message ?: cause.javaClass.simpleName
    return KiloAppStateDto(KiloAppStatusDto.ERROR, error = detail, errors = listOf(LoadErrorDto(resource, status, detail)))
}
