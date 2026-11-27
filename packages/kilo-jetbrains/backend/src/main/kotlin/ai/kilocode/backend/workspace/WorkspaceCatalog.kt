package ai.kilocode.backend.workspace

import ai.kilocode.rpc.dto.ModelAutoRoutingDto
import ai.kilocode.rpc.dto.ModelCacheCostDto
import ai.kilocode.rpc.dto.ModelCapabilitiesDto
import ai.kilocode.rpc.dto.ModelCostDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.ModelInputCapabilitiesDto
import ai.kilocode.rpc.dto.ModelLimitDto
import ai.kilocode.rpc.dto.ModelOptionsDto
import ai.kilocode.rpc.dto.ModelTerminalBenchDto
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.time.Instant

internal fun JsonObject.required(key: String) = getValue(key).jsonPrimitive.content
internal fun JsonObject.text(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull
internal fun JsonObject.flag(key: String) = (get(key) as? JsonPrimitive)?.booleanOrNull
internal fun JsonObject.number(key: String) = (get(key) as? JsonPrimitive)?.doubleOrNull
internal fun JsonObject.long(key: String) = (get(key) as? JsonPrimitive)?.longOrNull
internal fun JsonObject.obj(key: String) = get(key) as? JsonObject
internal fun JsonObject.strings(key: String) = (get(key) as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty()

internal fun selection(value: JsonElement?): String? = when (value) {
    is JsonPrimitive -> value.contentOrNull?.substringBefore('#')
    is JsonObject -> value.text("model")?.let { "${value.required("providerID")}/$it" }
    else -> null
}

internal fun variant(value: JsonElement?): String? = when (value) {
    is JsonPrimitive -> value.contentOrNull?.takeIf { '#' in it }?.substringAfter('#')
    is JsonObject -> value.text("variant")
    else -> null
}

internal fun pickerModel(model: JsonObject, gateway: JsonObject?): ModelDto {
    val limit = model.obj("limit")?.let { ModelLimitDto(it.long("context") ?: 0, it.long("input"), it.long("output") ?: 0) }
    val costs = (model["cost"] as? JsonArray).orEmpty().map { it.jsonObject }
    val cost = (costs.firstOrNull { "tier" !in it } ?: costs.firstOrNull())?.let { price ->
        ModelCostDto(price.number("input") ?: 0.0, price.number("output") ?: 0.0, price.obj("cache")?.let {
            ModelCacheCostDto(it.number("read") ?: 0.0, it.number("write") ?: 0.0)
        })
    }
    val caps = model.obj("capabilities")
    val input = caps?.strings("input").orEmpty().map { it.substringBefore('/') }.toSet()
    val variants = (model["variants"] as? JsonArray).orEmpty().map { it.jsonObject.required("id") }
    val reasoning = gateway?.flag("reasoning") ?: variants.isNotEmpty()
    return ModelDto(
        id = model.required("id"), name = model.required("name"), inputPrice = cost?.input, outputPrice = cost?.output,
        contextLength = limit?.context, releaseDate = model.obj("time")?.long("released")?.takeIf { it > 0 }
            ?.let { Instant.ofEpochMilli(it).toString() },
        attachment = input.any { it != "text" }, reasoning = reasoning, temperature = caps?.flag("temperature") == true,
        toolCall = caps?.flag("tools") == true, status = model.text("status"), variants = variants, limit = limit, cost = cost,
        free = gateway?.flag("isFree") ?: (model.text("providerID") == "kilo" && costs.isNotEmpty()
            && costs.all { it.number("input") == 0.0 && it.number("output") == 0.0 }),
        byok = gateway?.flag("hasUserByokAvailable") == true, recommendedIndex = gateway?.number("recommendedIndex"),
        capabilities = ModelCapabilitiesDto(reasoning, ModelInputCapabilitiesDto("text" in input, "image" in input,
            "audio" in input, "video" in input, "pdf" in input || "application/pdf" in caps?.strings("input").orEmpty())),
        options = gateway?.text("description")?.let(::ModelOptionsDto),
        autoRouting = gateway?.obj("autoRouting")?.let { ModelAutoRoutingDto(it.strings("models")) },
        terminalBench = gateway?.obj("terminalBench")?.let { ModelTerminalBenchDto(it.number("overallScore") ?: 0.0, it.number("avgAttemptCostUsd") ?: 0.0) },
        mayTrainOnYourPrompts = gateway?.flag("mayTrainOnYourPrompts") == true,
    )
}
