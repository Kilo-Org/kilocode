package ai.kilocode.backend.app

import ai.kilocode.backend.settings.*
import ai.kilocode.backend.v2.V2Client
import ai.kilocode.rpc.dto.*
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

class KiloAccountSettings(private val client: suspend () -> V2Client) {
    private val login = IntegrationLogin(client)

    suspend fun profile(): ProfileDto? {
        val api = client()
        if (
            api.plugin("kilocode.gateway", "authStatus")
                .jsonObject["authenticated"]
                ?.jsonPrimitive
                ?.boolean != true
        )
            return null
        val profile = api.plugin("kilocode.gateway", "profile").jsonObject
        val balance = optional {
            api.plugin("kilocode.gateway", "balance")
                .jsonObject["balance"]
                ?.jsonPrimitive
                ?.doubleOrNull
        }
        val pass = optional { api.plugin("kilocode.gateway", "kiloPass") as? JsonObject }
        return ProfileDto(
            profile.required("email"),
            profile.text("name"),
            profile.rows("organizations").map {
                ProfileOrganizationDto(
                    it.required("id"),
                    it.required("name"),
                    it.text("role").orEmpty(),
                )
            },
            profile.getValue("hasPersonalAccount").jsonPrimitive.boolean,
            balance?.let(::ProfileBalanceDto),
            pass?.let {
                ProfileKiloPassDto(
                    it.getValue("currentPeriodBaseCreditsUsd").jsonPrimitive.double,
                    it.getValue("currentPeriodUsageUsd").jsonPrimitive.double,
                    it.getValue("currentPeriodBonusCreditsUsd").jsonPrimitive.double,
                    it.text("nextBillingAt"),
                )
            },
            profile.text("organizationID"),
        )
    }

    private suspend fun <T> optional(block: suspend () -> T): T? =
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }

    suspend fun notifications() = client().plugin("kilocode.gateway", "notifications").jsonArray

    suspend fun startLogin(directory: String?): DeviceAuthDto {
        val method =
            client()
                .data("integration.get", directory, mapOf("integrationID" to "kilo"))
                .jsonObject
                .rows("methods")
                .firstOrNull { it.text("type") == "oauth" }
                ?: error("Kilo Gateway sign-in is not available on this server")
        val attempt = login.begin(directory, "kilo", method.required("id"))
        val time = attempt.obj("time")
        val ttl =
            (time.getValue("expires").jsonPrimitive.long - System.currentTimeMillis())
                .coerceAtLeast(0) / 1000
        val url = attempt.required("url")
        val code =
            url.toHttpUrlOrNull()?.queryParameter("code")
                ?: attempt.text("instructions")?.let {
                    Regex("code:\\s*(\\S+)", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1)
                }
        return DeviceAuthDto(code, url, ttl.toInt())
    }

    suspend fun completeLogin(directory: String?): ProfileDto? {
        login.finish(directory, "kilo")
        return profile()
    }

    suspend fun logout() = client().removeConnections(null, "kilo")

    suspend fun setOrganization(id: String?): ProfileDto? {
        client()
            .plugin(
                "kilocode.gateway",
                "organization.set",
                input =
                    buildJsonObject { put("organizationID", id?.let(::JsonPrimitive) ?: JsonNull) },
            )
        return profile()
    }
}
