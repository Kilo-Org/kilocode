package ai.kilocode.backend.provider

import ai.kilocode.backend.settings.*
import ai.kilocode.backend.v2.V2Client
import ai.kilocode.backend.workspace.KiloWorkspaceData
import ai.kilocode.rpc.dto.*
import com.intellij.util.EnvironmentUtil
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request

internal class KiloBackendProviderSettingsManager(
    private val client: suspend () -> V2Client = ::settingsClient
) {
    private val login = IntegrationLogin(client)

    private companion object {
        const val CUSTOM = "@opencode/ai/providers/openai-compatible"
        val http by lazy {
            OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build()
        }
    }

    suspend fun state(directory: String): ProviderSettingsDto {
        val api = client()
        val errors = mutableListOf<LoadErrorDto>()
        suspend fun <T> load(name: String, block: suspend () -> T): T? =
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                errors.add(LoadErrorDto(name, detail = e.message))
                null
            }
        val catalog = load("providers") { KiloWorkspaceData(api, directory).providers() }
        val integrations =
            load("integrations") {
                    api.data("integration.list", directory)
                        .jsonArray
                        .map { it.jsonObject }
                        .associateBy { it.required("id") }
                }
                .orEmpty()
        val mcp =
            load("mcp") {
                    api.data("mcp.list", directory)
                        .jsonArray
                        .mapNotNull { it.jsonObject.text("integrationID") }
                        .toSet()
                }
                .orEmpty()
        val runtime =
            load("provider_integrations") {
                    api.data("provider.list", directory).jsonArray.associate {
                        it.jsonObject.required("id") to it.jsonObject.text("integrationID")
                    }
                }
                .orEmpty()
        val docs =
            listOf("global", "project").associateWith {
                load("${it}_config") { api.document(directory, it) } ?: emptyObject
            }
        val config =
            docs
                .flatMap { (scope, doc) ->
                    doc.obj("providers").map { (id, v) -> id to parse(id, v.jsonObject, scope) }
                }
                .toMap()
        val visible =
            (catalog?.providers.orEmpty().map { it.id } +
                    (integrations.keys -
                        mcp -
                        runtime.values.filterNotNull().filter { it !in runtime.keys }.toSet()) +
                    config.keys)
                .distinct()
        val providers =
            visible.map { id ->
                val row = catalog?.providers?.find { it.id == id }
                val integration = integrations[runtime[id] ?: id]
                val source =
                    when {
                        config.containsKey(id) -> "config"
                        integration?.rows("connections")?.any { it.text("type") == "env" } ==
                            true -> "env"
                        else -> row?.source
                    }
                val metadata = integration?.obj("metadata")
                ProviderSettingsProviderDto(
                    id,
                    row?.name ?: integration?.text("name") ?: config[id]?.name ?: id,
                    description = metadata?.text("description"),
                    source = source,
                    models = row?.models.orEmpty(),
                )
            }
        fun scopes(effect: String) =
            docs
                .flatMap { (scope, doc) ->
                    doc.rows("policies")
                        .filter {
                            it.text("action") == "provider.use" &&
                                it.text("effect") == effect &&
                                it.text("resource") != "*"
                        }
                        .map { it.required("resource") to uiScope(scope) }
                }
                .groupBy({ it.first }, { it.second })
        val disabled = scopes("deny")
        val enabled = scopes("allow")
        return ProviderSettingsDto(
            providers,
            visible.filter {
                integrations[runtime[it] ?: it]?.rows("connections")?.isNotEmpty() == true
            },
            catalog?.defaults.orEmpty(),
            visible.associateWith { methods(integrations[runtime[it] ?: it]).map(::methodDto) },
            config,
            disabled.keys.sorted(),
            enabled.keys.sorted(),
            disabled,
            enabled,
            errors,
        )
    }

    private fun methods(info: JsonObject?) =
        info?.rows("methods").orEmpty().filter { it.text("type") in setOf("key", "oauth") }

    private fun methodDto(row: JsonObject) =
        ProviderAuthMethodDto(
            if (row.text("type") == "key") "api" else "oauth",
            row.text("label") ?: "API key",
            row.rows("form").map { field ->
                val condition = field.rows("when").firstOrNull()
                ProviderAuthPromptDto(
                    field.required("key"),
                    field.text("title") ?: field.required("key"),
                    if (field.rows("options").isNotEmpty()) "select" else "text",
                    field.rows("options").map {
                        ProviderAuthOptionDto(it.required("label"), it.required("value"))
                    },
                    condition?.text("key"),
                    condition?.text("op"),
                    condition?.text("value"),
                )
            },
        )

    private suspend fun integration(directory: String, id: String): String =
        client()
            .data("provider.list", directory)
            .jsonArray
            .find { it.jsonObject.text("id") == id }
            ?.jsonObject
            ?.text("integrationID") ?: id

    suspend fun connect(input: ProviderConnectDto): ProviderActionResultDto {
        client()
            .call(
                "integration.connect.key",
                mapOf("integrationID" to integration(input.directory, input.providerId)),
                location(input.directory),
                buildJsonObject {
                    put("key", input.key)
                    if (input.metadata.isNotEmpty()) put("answer", input.metadata.asJson())
                },
            )
        return ProviderActionResultDto(state(input.directory))
    }

    suspend fun authorize(input: ProviderOAuthAuthorizeDto): ProviderOAuthReadyDto {
        val id = integration(input.directory, input.providerId)
        val row =
            client()
                .data("integration.get", input.directory, mapOf("integrationID" to id))
                .jsonObject
        val method = methods(row)[input.method.toInt()]
        require(method.text("type") == "oauth")
        val attempt = login.begin(input.directory, id, method.required("id"), input.inputs)
        return ProviderOAuthReadyDto(
            attempt.required("url"),
            attempt.required("mode"),
            attempt.text("instructions"),
        )
    }

    suspend fun callback(input: ProviderOAuthCallbackDto): ProviderActionResultDto {
        login.finish(input.directory, integration(input.directory, input.providerId), input.code)
        return ProviderActionResultDto(state(input.directory))
    }

    suspend fun disconnect(input: ProviderDisconnectDto): ProviderActionResultDto {
        val state = state(input.directory)
        val id = input.providerId
        if (id == "kilo")
            return ProviderActionResultDto(
                state,
                error = "Use the account panel to sign out of Kilo Gateway",
            )
        val config = state.config[id]
        val scope = if (config?.scope == "workspace") "project" else "global"
        val provider = state.providers.firstOrNull { it.id == id }
        val api = client()
        val integrationID = integration(input.directory, id)
        if (config?.npm == CUSTOM) {
            if (id in state.connected && provider?.source != "env")
                api.removeConnections(input.directory, integrationID)
            api.write(
                input.directory,
                scope,
                buildJsonObject { put("providers", buildJsonObject { put(id, JsonNull) }) },
            )
        } else if (config != null) policy(input.directory, scope, id, false)
        else if (
            provider?.source == "env" || !api.removeConnections(input.directory, integrationID)
        )
            return ProviderActionResultDto(state, error = "Provider has no stored credentials")
        return ProviderActionResultDto(state(input.directory))
    }

    suspend fun enable(input: ProviderEnableDto): ProviderActionResultDto {
        for (scope in listOf("global", "project")) policy(
            input.directory,
            scope,
            input.providerId,
            true,
        )
        return ProviderActionResultDto(state(input.directory))
    }

    private suspend fun policy(directory: String, scope: String, id: String, enable: Boolean) {
        val api = client()
        val rules = api.document(directory, scope).rows("policies")
        val next =
            rules
                .filterNot {
                    it.text("action") == "provider.use" &&
                        it.text("resource") == id &&
                        it.text("effect") == "deny"
                }
                .toMutableList()
        val decision =
            next.lastOrNull { rule ->
                rule.text("action") == "provider.use" &&
                    rule.text("resource")?.let { pattern ->
                        Regex(
                                pattern.split('*').joinToString(".*") {
                                    it.split('?').joinToString(".") { p -> Regex.escape(p) }
                                }
                            )
                            .matches(id)
                    } == true
            }
        if (!enable || decision?.text("effect") == "deny")
            next.add(
                mapOf(
                        "action" to "provider.use",
                        "resource" to id,
                        "effect" to if (enable) "allow" else "deny",
                    )
                    .asJson()
            )
        if (rules != next)
            api.write(
                directory,
                scope,
                buildJsonObject {
                    put("policies", if (next.isEmpty()) JsonNull else JsonArray(next))
                },
            )
    }

    private fun uiScope(scope: String) = if (scope == "project") "workspace" else "global"

    private fun parse(id: String, row: JsonObject, scope: String) =
        CustomProviderConfigDto(
            id,
            row.text("name"),
            row.text("package"),
            row.strings("env"),
            row.obj("settings")
                .filterKeys { it != "apiKey" }
                .mapNotNull { (k, v) -> (v as? JsonPrimitive)?.contentOrNull?.let { k to it } }
                .toMap(),
            row.obj("headers").mapValues { it.value.jsonPrimitive.content },
            row.obj("models").mapValues { (k, v) ->
                CustomModelDto(
                    k,
                    v.jsonObject.text("name") ?: k,
                    v.jsonObject.obj("capabilities").obj("reasoning").text("supported") == "true",
                )
            },
            uiScope(scope),
        )

    suspend fun saveCustom(input: CustomProviderSaveDto): ProviderActionResultDto {
        require(
            input.id.matches(Regex("[a-zA-Z0-9_-]+")) &&
                input.baseUrl.matches(Regex("https?://.+")) &&
                input.models.isNotEmpty() &&
                input.models.none { it.id.isBlank() }
        )
        val env = input.envVar?.trim()?.takeIf(String::isNotEmpty)
        require(env == null || env.matches(Regex("[A-Za-z_][A-Za-z0-9_]*")))
        val api = client()
        val docs =
            listOf("global", "project").associateWith {
                api.document(input.directory, it).obj("providers")[input.id] as? JsonObject
            }
        val scope = if (docs["project"] == null) "global" else "project"
        val models =
            input.models.associate { model ->
                model.id to
                    buildJsonObject {
                        put("name", model.name)
                        put(
                            "capabilities",
                            buildJsonObject {
                                put(
                                    "reasoning",
                                    buildJsonObject { put("supported", model.reasoning) },
                                )
                            },
                        )
                    }
            }
        for ((s, old) in docs) {
            val removed =
                old?.obj("models").orEmpty().keys.minus(models.keys).associateWith { JsonNull }
            if (s != scope && removed.isEmpty()) continue
            val values = buildJsonObject {
                put("models", JsonObject(if (s == scope) removed + models else removed))
                if (s == scope) {
                    put("name", input.name)
                    put("package", CUSTOM)
                    put("settings", buildJsonObject { put("baseURL", input.baseUrl) })
                    put("env", env?.let { JsonArray(listOf(JsonPrimitive(it))) } ?: JsonNull)
                    if (input.headers.isNotEmpty()) put("headers", input.headers.asJson())
                }
            }
            api.write(
                input.directory,
                s,
                buildJsonObject { put("providers", buildJsonObject { put(input.id, values) }) },
            )
        }
        if (env == null && !input.apiKey.isNullOrBlank())
            api.call(
                "credential.create",
                body =
                    buildJsonObject {
                        put("integrationID", input.id)
                        put(
                            "value",
                            buildJsonObject {
                                put("type", "key")
                                put("key", input.apiKey)
                            },
                        )
                    },
            )
        if (env != null) {
            api.data("credential.list")
                .jsonArray
                .map { it.jsonObject }
                .filter {
                    it.text("integrationID") == input.id && it.obj("value").text("type") == "key"
                }
                .forEach {
                    api.call("credential.remove", mapOf("credentialID" to it.required("id")))
                }
        }
        return ProviderActionResultDto(state(input.directory))
    }

    suspend fun fetch(
        input: CustomModelFetchDto,
        env: Map<String, String> = EnvironmentUtil.getEnvironmentMap(),
    ): CustomModelFetchResultDto =
        withContext(Dispatchers.IO) {
            val variable = input.env?.takeIf(String::isNotBlank)
            try {
                val key =
                    input.apiKey?.takeIf(String::isNotBlank)
                        ?: if (variable != null) env[variable] else storedKey(input)
                val request =
                    Request.Builder()
                        .url(input.baseUrl.trimEnd('/') + "/models")
                        .apply {
                            key?.let { header("Authorization", "Bearer $it") }
                            input.headers.forEach { (k, v) -> header(k, v) }
                        }
                        .build()
                val ids =
                    http.newCall(request).execute().use { response ->
                        check(response.isSuccessful) { "Provider returned HTTP ${response.code}" }
                        Json.parseToJsonElement(response.body?.string().orEmpty())
                            .jsonObject
                            .rows("data")
                            .mapNotNull { it.text("id") }
                            .distinct()
                            .sorted()
                    }
                CustomModelFetchResultDto(
                    ids,
                    envMissing = variable != null && env[variable].isNullOrBlank(),
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                CustomModelFetchResultDto(
                    error = e.message,
                    envMissing = variable != null && env[variable].isNullOrBlank(),
                )
            }
        }

    private suspend fun storedKey(input: CustomModelFetchDto): String? {
        val id = input.providerId ?: return null
        val api = client()
        val provider =
            api.data("provider.list", input.directory)
                .jsonArray
                .map { it.jsonObject }
                .find { it.text("id") == id } ?: return null
        if (input.baseUrl.trimEnd('/') != provider.obj("settings").text("baseURL")?.trimEnd('/'))
            return null
        val keys =
            api.data("credential.list")
                .jsonArray
                .map { it.jsonObject }
                .filter {
                    it.text("integrationID") == (provider.text("integrationID") ?: id) &&
                        it.obj("value").text("type") == "key"
                }
        return (keys.firstOrNull { it.text("active") == "true" } ?: keys.lastOrNull())
            ?.obj("value")
            ?.text("key")
    }
}
