package ai.kilocode.backend.provider

import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.app.LoadError
import ai.kilocode.backend.cli.KiloBackendHttpClients
import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.backend.rpc.KiloWorkspaceDtoMapper
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.CustomModelFetchDto
import ai.kilocode.rpc.dto.CustomModelFetchResultDto
import ai.kilocode.rpc.dto.CustomProviderConfigDto
import ai.kilocode.rpc.dto.CustomProviderSaveDto
import ai.kilocode.rpc.dto.LoadErrorDto
import ai.kilocode.rpc.dto.ProviderActionResultDto
import ai.kilocode.rpc.dto.ProviderConnectDto
import ai.kilocode.rpc.dto.ProviderDisconnectDto
import ai.kilocode.rpc.dto.ProviderEnableDto
import ai.kilocode.rpc.dto.ProviderOAuthAuthorizeDto
import ai.kilocode.rpc.dto.ProviderOAuthCallbackDto
import ai.kilocode.rpc.dto.ProviderOAuthReadyDto
import ai.kilocode.rpc.dto.ProviderSettingsDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

internal class KiloBackendProviderSettingsManager(
    private val app: KiloBackendAppService,
) {
    companion object {
        private val LOG = KiloLog.create(KiloBackendProviderSettingsManager::class.java)
        private val JSON = "application/json".toMediaType()
        private val FETCH by lazy { KiloBackendHttpClients.modelFetch() }
        private const val CALL_TIMEOUT_SECONDS = 15L
        private const val OAUTH_CALL_TIMEOUT_SECONDS = 60L
    }

    suspend fun state(directory: String): ProviderSettingsDto {
        val start = System.currentTimeMillis()
        LOG.debug { "provider settings state: start dir=$directory" }
        app.awaitReady()
        val errors = mutableListOf<LoadErrorDto>()
        val providers = load("providers", errors) {
            KiloCliDataParser.parseProviderSettingsProviders(get("/provider?directory=${enc(directory)}"))
        }
        val auth = load("provider_auth", errors) {
            KiloCliDataParser.parseProviderAuth(get("/provider/auth?directory=${enc(directory)}"))
        } ?: emptyMap()
        val empty = ParsedConfig(emptyMap(), emptyList(), emptyList())
        val global = load("global_config", errors) {
            parsed(get("/global/config"))
        } ?: empty
        val local = load("workspace_config", errors) {
            parsed(get("/config?directory=${enc(directory)}"))
        } ?: empty
        val cfg = scopedConfig(global.config, local.config)
        val disabled = (global.disabled + local.disabled).distinct().sorted()
        val enabled = (global.enabled + local.enabled).distinct().sorted()
        val disabledScopes = scopedIds(global.disabled, local.disabled)
        val enabledScopes = scopedIds(global.enabled, local.enabled)
        val result = ProviderSettingsDto(
            providers = providers?.first ?: emptyList(),
            connected = providers?.second ?: emptyList(),
            defaults = providers?.third ?: emptyMap(),
            auth = auth,
            config = cfg,
            disabled = disabled,
            enabled = enabled,
            disabledScopes = disabledScopes,
            enabledScopes = enabledScopes,
            errors = errors,
        )
        result.providers.forEach { provider ->
            val configured = provider.id in result.connected || provider.key != null || provider.source == "config" || provider.id in result.config
            LOG.debug {
                "provider settings provider: id=${provider.id} source=${provider.source} connected=${provider.id in result.connected} configured=$configured disabled=${provider.id in result.disabled} enabled=${provider.id in result.enabled} hasKey=${provider.key != null} auth=${result.auth[provider.id].orEmpty().map { it.type }.distinct().joinToString(",")} config=${provider.id in result.config} models=${provider.models.size} description=${provider.description?.isNotBlank() == true} noteKey=${provider.metadata?.noteKey} icon=${provider.metadata?.icon} priority=${provider.metadata?.priority}"
            }
        }
        LOG.debug { "provider settings state: completed dir=$directory providers=${result.providers.size} connected=${result.connected.size} auth=${result.auth.size} errors=${result.errors.size} durationMs=${System.currentTimeMillis() - start}" }
        return result
    }

    suspend fun connect(input: ProviderConnectDto): ProviderActionResultDto {
        val body = KiloCliDataParser.buildProviderAuthJson(input.key, input.metadata)
        put("/auth/${enc(input.providerId)}", body)
        dispose()
        return ProviderActionResultDto(state(input.directory))
    }

    suspend fun authorize(input: ProviderOAuthAuthorizeDto): ProviderOAuthReadyDto {
        val body = KiloCliDataParser.buildProviderOAuthJson(input.method, input.inputs)
        val raw = post("/provider/${enc(input.providerId)}/oauth/authorize?directory=${enc(input.directory)}", body, OAUTH_CALL_TIMEOUT_SECONDS)
        val parsed = KiloCliDataParser.parseOAuthReady(raw)
        return ProviderOAuthReadyDto(parsed.first, parsed.second, parsed.third)
    }

    suspend fun callback(input: ProviderOAuthCallbackDto): ProviderActionResultDto {
        val body = KiloCliDataParser.buildProviderOAuthJson(input.method, code = input.code)
        post("/provider/${enc(input.providerId)}/oauth/callback?directory=${enc(input.directory)}", body, OAUTH_CALL_TIMEOUT_SECONDS)
        dispose()
        return ProviderActionResultDto(state(input.directory))
    }

    suspend fun disconnect(input: ProviderDisconnectDto): ProviderActionResultDto {
        val current = state(input.directory)
        val provider = current.providers.firstOrNull { it.id == input.providerId }
        val cfg = current.config[input.providerId]
        if (input.providerId == "kilo") {
            return ProviderActionResultDto(current, error = "Kilo Gateway cannot be disconnected from provider settings.")
        }
        if (provider?.source == "env") {
            return ProviderActionResultDto(current, error = "Provider is configured by environment variables.")
        }
        val configured = input.providerId in current.connected || provider?.key != null || provider?.source == "config" || cfg != null
        if (!configured) {
            return ProviderActionResultDto(current, error = "Provider is not connected.")
        }
        if (cfg?.npm == "@ai-sdk/openai-compatible") {
            patch(input.directory, cfg.scope, KiloCliDataParser.buildCustomProviderDeletePatch(input.providerId))
            deleteAuth(input.providerId)
            dispose()
            return ProviderActionResultDto(state(input.directory))
        }
        if (provider?.source == "config") {
            val scope = cfg?.scope ?: "global"
            val ids = disabledFor(current, scope) + input.providerId
            patch(input.directory, scope, KiloCliDataParser.buildDisabledProviderPatch(ids))
            dispose()
            return ProviderActionResultDto(state(input.directory))
        }
        deleteAuth(input.providerId)
        dispose()
        return ProviderActionResultDto(state(input.directory))
    }

    suspend fun enable(input: ProviderEnableDto): ProviderActionResultDto {
        val current = state(input.directory)
        val scopes = current.disabledScopes[input.providerId]?.takeIf { it.isNotEmpty() } ?: listOf("global")
        scopes.distinct().forEach { scope ->
            patch(input.directory, scope, KiloCliDataParser.buildDisabledProviderPatch(disabledFor(current, scope).filter { it != input.providerId }))
        }
        dispose()
        return ProviderActionResultDto(state(input.directory))
    }

    suspend fun saveCustom(input: CustomProviderSaveDto): ProviderActionResultDto {
        val err = validate(input)
        if (err != null) return ProviderActionResultDto(state(input.directory), error = err)
        patch(KiloCliDataParser.buildCustomProviderPatch(input))
        if (input.envVar.isNullOrBlank()) {
            val key = input.apiKey?.takeIf { it.isNotBlank() }
            if (key != null) put("/auth/${enc(input.id)}", KiloCliDataParser.buildProviderAuthJson(key, emptyMap()))
        } else {
            deleteAuth(input.id)
        }
        dispose()
        return ProviderActionResultDto(state(input.directory))
    }

    suspend fun fetch(input: CustomModelFetchDto): CustomModelFetchResultDto {
        val url = input.baseUrl.trim().trimEnd('/') + "/models"
        return try {
            val request = Request.Builder().url(url).get().apply {
                input.apiKey?.takeIf { it.isNotBlank() }?.let { header("Authorization", "Bearer $it") }
                input.headers.forEach { (key, value) -> header(key, value) }
            }.build()
            val raw = withContext(Dispatchers.IO) {
                FETCH.newCall(request).execute().use { response ->
                    val body = response.body?.string().orEmpty()
                    if (!response.isSuccessful) throw IllegalStateException("HTTP ${response.code}: $body")
                    body
                }
            }
            CustomModelFetchResultDto(KiloCliDataParser.parseModelIds(raw))
        } catch (e: Exception) {
            LOG.warn("Custom provider model fetch failed: ${e.message}", e)
            CustomModelFetchResultDto(error = e.message)
        }
    }

    private suspend fun <T> load(resource: String, errors: MutableList<LoadErrorDto>, block: suspend () -> T): T? {
        val start = System.currentTimeMillis()
        LOG.debug { "provider settings $resource: start" }
        return try {
            val result = block()
            LOG.debug { "provider settings $resource: completed durationMs=${System.currentTimeMillis() - start}" }
            result
        } catch (e: Exception) {
            LOG.warn("Provider settings $resource fetch failed durationMs=${System.currentTimeMillis() - start}: ${e.message}", e)
            errors.add(KiloWorkspaceDtoMapper.error(LoadError(resource = resource, detail = e.message)))
            null
        }
    }

    private suspend fun get(path: String) = request(Request.Builder().url(url(path)).get().build())
    private suspend fun post(path: String, body: String, timeoutSeconds: Long = CALL_TIMEOUT_SECONDS) = request(Request.Builder().url(url(path)).post(body.toRequestBody(JSON)).build(), timeoutSeconds)
    private suspend fun put(path: String, body: String) = request(Request.Builder().url(url(path)).put(body.toRequestBody(JSON)).build())
    private suspend fun patch(body: String) = request(Request.Builder().url(url("/global/config")).patch(body.toRequestBody(JSON)).build())
    private suspend fun patch(directory: String, scope: String, body: String) {
        val path = if (scope == "workspace") "/config?directory=${enc(directory)}" else "/global/config"
        request(Request.Builder().url(url(path)).patch(body.toRequestBody(JSON)).build())
    }

    private fun parsed(raw: String): ParsedConfig {
        val result = KiloCliDataParser.parseProviderConfig(raw)
        return ParsedConfig(result.first, result.second.first, result.second.second)
    }

    private fun scopedConfig(global: Map<String, CustomProviderConfigDto>, local: Map<String, CustomProviderConfigDto>): Map<String, CustomProviderConfigDto> {
        val ids = (global.keys + local.keys).distinct()
        return ids.mapNotNull { id ->
            val localCfg = local[id]
            val globalCfg = global[id]
            val cfg = localCfg ?: globalCfg ?: return@mapNotNull null
            val scope = if (localCfg != null && (globalCfg == null || localCfg.withoutScope() != globalCfg.withoutScope())) "workspace" else "global"
            id to cfg.copy(scope = scope)
        }.toMap()
    }

    private fun scopedIds(global: List<String>, local: List<String>): Map<String, List<String>> {
        val globals = global.toSet()
        return (global + local).distinct().associateWith { id ->
            buildList {
                if (id in globals) add("global")
                if (id in local && id !in globals) add("workspace")
            }
        }
    }

    private fun disabledFor(state: ProviderSettingsDto, scope: String): List<String> =
        state.disabledScopes.entries.filter { scope in it.value }.map { it.key }

    private fun CustomProviderConfigDto.withoutScope() = copy(scope = "global")

    private suspend fun deleteAuth(id: String) {
        runCatching { request(Request.Builder().url(url("/auth/${enc(id)}")).delete().build()) }
            .onFailure { LOG.warn("Provider auth delete failed for $id: ${it.message}", it) }
    }

    private suspend fun dispose() {
        runCatching { request(Request.Builder().url(url("/global/dispose")).post("{}".toRequestBody(JSON)).build()) }
            .onFailure { LOG.debug { "Provider settings dispose skipped: ${it.message}" } }
    }

    private suspend fun request(request: Request, timeoutSeconds: Long = CALL_TIMEOUT_SECONDS): String {
        val start = System.currentTimeMillis()
        LOG.debug { "provider settings http: start ${request.method} ${request.url.encodedPath}" }
        val http = app.http?.let { KiloBackendHttpClients.bounded(it, timeoutSeconds) }
            ?: throw IllegalStateException("Kilo HTTP client is unavailable")
        return withContext(Dispatchers.IO) {
            try {
                http.newCall(request.newBuilder().header("Accept", "application/json").build()).execute().use { response ->
                    val body = response.body?.string().orEmpty()
                    LOG.debug { "provider settings http: completed ${request.method} ${request.url.encodedPath} code=${response.code} bytes=${body.length} durationMs=${System.currentTimeMillis() - start}" }
                    if (!response.isSuccessful) throw IllegalStateException("HTTP ${response.code}: $body")
                    body
                }
            } catch (e: Exception) {
                LOG.debug { "provider settings http: failed ${request.method} ${request.url.encodedPath} durationMs=${System.currentTimeMillis() - start}: ${e.message}" }
                throw e
            }
        }
    }

    private fun url(path: String) = "http://127.0.0.1:${app.port}$path"

    private fun enc(value: String) = URLEncoder.encode(value, StandardCharsets.UTF_8)

    private fun validate(input: CustomProviderSaveDto): String? {
        val env = input.envVar
        if (!Regex("^[a-zA-Z0-9_-]+$").matches(input.id.trim())) return "Provider ID can only contain letters, numbers, underscores, and hyphens."
        if (!input.baseUrl.startsWith("http://") && !input.baseUrl.startsWith("https://")) return "Base URL must start with http:// or https://."
        if (!env.isNullOrBlank() && !Regex("^[A-Za-z_][A-Za-z0-9_]*$").matches(env)) return "Environment variable name is invalid."
        if (input.headers.keys.any { it.isBlank() }) return "Header names cannot be empty."
        if (input.models.isEmpty()) return "At least one model ID is required."
        if (input.models.any { it.id.isBlank() }) return "Model IDs cannot be empty."
        return null
    }

    private data class ParsedConfig(
        val config: Map<String, CustomProviderConfigDto>,
        val disabled: List<String>,
        val enabled: List<String>,
    )
}
