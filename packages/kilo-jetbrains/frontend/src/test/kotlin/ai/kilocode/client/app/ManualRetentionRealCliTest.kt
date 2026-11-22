package ai.kilocode.client.app

import ai.kilocode.rpc.KiloAppRpcApi
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.DeviceAuthDto
import ai.kilocode.rpc.dto.HealthDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.LogConfigDto
import ai.kilocode.rpc.dto.LogFileDto
import ai.kilocode.rpc.dto.ModelFavoriteUpdateDto
import ai.kilocode.rpc.dto.ModelSelectionUpdateDto
import ai.kilocode.rpc.dto.ModelStateDto
import ai.kilocode.rpc.dto.ModelVariantUpdateDto
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.ProfileSyncDto
import ai.kilocode.rpc.dto.RetentionConfigDto
import ai.kilocode.rpc.dto.RetentionPatchDto
import ai.kilocode.rpc.dto.RetentionPolicyDto
import ai.kilocode.rpc.dto.RetentionStatusDto
import ai.kilocode.rpc.dto.SpeechModelDto
import ai.kilocode.rpc.dto.SpeechRequestDto
import ai.kilocode.rpc.dto.SpeechResultDto
import ai.kilocode.rpc.dto.TelemetryCaptureDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.Credentials
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.jupiter.api.Assumptions.assumeTrue
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * Real-CLI proof for [KiloAppService.runManualRetention]: a one-off cleanup enables the machine-wide
 * retention policy, runs a pass, and puts the saved policy back.
 *
 * Requires a running `bun dev serve` from this checkout plus the global config file that server
 * writes, and it is skipped in CI because none of those exist there. Set:
 *
 * - `KILO_E2E_CLI_PORT`: the port the server announced (`kilo server listening on http://…`).
 * - `KILO_E2E_CLI_PASSWORD`: the server's basic-auth password (`KILO_SERVER_PASSWORD`).
 * - `KILO_E2E_CONFIG_FILE`: the global `kilo.json`/`kilo.jsonc` the server patches for retention.
 *
 * Nothing here goes through the backend module: the tests speak the CLI's HTTP API directly with
 * okhttp, so the frontend service is exercised against a real process rather than a fake RPC. The
 * responses are decoded into module-local wire types, never into a shared DTO's own serializer,
 * because the frontend cannot rely on that classloader in production.
 */
class ManualRetentionRealCliTest {

    @Test
    fun `manual cleanup leaves a disabled policy disabled`() = runBlocking {
        val env = harness()
        val api = HttpAppApi(env.port, env.password)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            api.patchRetention(RetentionPatchDto(enabled = false, maxAgeDays = 30))
            assertFalse(api.retentionStatus().policy.enabled, "the CLI must start from a disabled retention policy")

            val app = KiloAppService(scope, api)
            val result = app.runManualRetention(RetentionPatchDto(enabled = false, maxAgeDays = 30))

            assertIs<ManualRetentionResult.Complete>(result, "cleanup should run and restore the saved policy: $result")
            assertEquals(30, result.status.policy.maxAgeDays, "the pass reports the policy it ran under")
            assertFalse(
                api.retentionStatus().policy.enabled,
                "the saved disabled policy must be back on the CLI after a one-off cleanup",
            )
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun `an unrestorable policy reports PolicyNotRestored leaves the policy on and stops after three attempts`() = runBlocking {
        val env = harness()
        val api = LockAfterEnable(env.port, env.password, env.configFile)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val config = env.configFile
        try {
            assertTrue(config.isFile, "KILO_E2E_CONFIG_FILE must be the file the CLI writes: ${config.absolutePath}")
            config.setWritable(true)
            api.patchRetention(RetentionPatchDto(enabled = false, maxAgeDays = 30))
            assertFalse(api.retentionStatus().policy.enabled, "this case starts from a disabled saved policy")
            api.restoreWrites.set(0)
            api.lockOnEnable = true

            val app = KiloAppService(scope, api)
            val result = app.runManualRetention(RetentionPatchDto(enabled = false, maxAgeDays = 30))

            assertIs<ManualRetentionResult.PolicyNotRestored>(
                result,
                "an unwritable config file must report the unrestored policy, not a completed cleanup: $result",
            )
            assertFalse(config.canWrite(), "the config file must still be read-only when the restore gives up")
            assertTrue(
                api.retentionStatus().policy.enabled,
                "the enabling write landed and the restore never did, so the CLI policy really is still on",
            )
            assertEquals(
                3,
                api.restoreWrites.get(),
                "the restore is bounded, not endless: three attempts, no more",
            )
        } finally {
            config.setWritable(true)
            scope.cancel()
        }
    }

    private class Harness(val port: Int, val password: String, val configFile: File)

    /** Reads the three harness variables and skips the test when any is absent. */
    private fun harness(): Harness {
        val port = System.getenv("KILO_E2E_CLI_PORT")
        val password = System.getenv("KILO_E2E_CLI_PASSWORD")
        val config = System.getenv("KILO_E2E_CONFIG_FILE")
        assumeTrue(port != null, "set KILO_E2E_CLI_PORT to the port of a running `bun dev serve`")
        assumeTrue(password != null, "set KILO_E2E_CLI_PASSWORD to that server's basic-auth password")
        assumeTrue(config != null, "set KILO_E2E_CONFIG_FILE to the global config file that server writes")
        return Harness(port!!.toInt(), password!!, File(config!!))
    }

    /**
     * [KiloAppRpcApi] over the CLI's loopback HTTP API.
     *
     * Only the three retention-relevant calls are implemented; every other member is a tripwire,
     * because reaching one means the retention path grew a dependency the harness does not model.
     */
    private open class HttpAppApi(private val port: Int, private val password: String) : KiloAppRpcApi {

        private val client = OkHttpClient.Builder()
            .callTimeout(60, TimeUnit.SECONDS)
            .build()

        private val base = "http://127.0.0.1:$port"

        private val json = Json { ignoreUnknownKeys = true }

        /** Apply a retention patch the way the settings UI does: through `PATCH /global/config`. */
        suspend fun patchRetention(policy: RetentionPatchDto) {
            updateConfig(ConfigPatchDto(retention = policy))
        }

        override suspend fun updateConfig(patch: ConfigPatchDto): KiloAppStateDto {
            val retention = patch.retention
            val body = buildJsonObject {
                if (retention != null) {
                    putJsonObject("retention") {
                        retention.enabled?.let { put("enabled", it) }
                        retention.maxAgeDays?.let { put("maxAgeDays", it) }
                    }
                }
            }.toString()
            val request = Request.Builder()
                .url("$base/global/config")
                .header("Authorization", Credentials.basic(USER, password))
                .header("Accept", "application/json")
                .patch(body.toRequestBody(JSON))
                .build()
            execute(request)
            return KiloAppStateDto(
                KiloAppStatusDto.READY,
                config = ConfigDto(
                    retention = RetentionConfigDto(retention?.enabled, retention?.maxAgeDays),
                ),
            )
        }

        override suspend fun retentionStatus(): RetentionStatusDto {
            val request = Request.Builder()
                .url("$base/kilocode/retention")
                .header("Authorization", Credentials.basic(USER, password))
                .header("Accept", "application/json")
                .get()
                .build()
            return json.decodeFromString<WireStatus>(execute(request)).toDto()
        }

        override suspend fun runRetention(force: Boolean): RetentionStatusDto {
            val request = Request.Builder()
                .url("$base/kilocode/retention/run")
                .header("Authorization", Credentials.basic(USER, password))
                .header("Accept", "application/json")
                .post(buildJsonObject { put("force", force) }.toString().toRequestBody(JSON))
                .build()
            return json.decodeFromString<WireStatus>(execute(request)).toDto()
        }

        /** Runs one call and fails loudly on a non-2xx answer, so a silent 500 cannot look like success. */
        private fun execute(request: Request): String = client.newCall(request).execute().use { response ->
            val body = response.body.string()
            if (!response.isSuccessful) {
                throw IllegalStateException("${request.method} ${request.url.encodedPath} failed: HTTP ${response.code}")
            }
            body
        }

        override suspend fun state(): Flow<KiloAppStateDto> = emptyFlow()

        override suspend fun connect(): Unit = unused()
        override suspend fun health(): HealthDto = unused()
        override suspend fun cliVersion(): String = unused()
        override suspend fun cliPlatform(): String = unused()
        override suspend fun cliBundled(): Boolean = unused()
        override suspend fun retry(): Unit = unused()
        override suspend fun restart(): Unit = unused()
        override suspend fun reinstall(): Unit = unused()
        override suspend fun modelState(): ModelStateDto = unused()
        override suspend fun updateModelFavorite(update: ModelFavoriteUpdateDto): ModelStateDto = unused()
        override suspend fun updateModelSelection(update: ModelSelectionUpdateDto): ModelStateDto = unused()
        override suspend fun clearModelSelection(agent: String): ModelStateDto = unused()
        override suspend fun updateModelVariant(update: ModelVariantUpdateDto): ModelStateDto = unused()
        override suspend fun setTelemetryLevel(enabled: Boolean): KiloAppStateDto = unused()
        override suspend fun applyLogConfig(config: LogConfigDto): Unit = unused()
        override suspend fun indexWorktrees(): Boolean = unused()
        override suspend fun setIndexWorktrees(value: Boolean): Unit = unused()
        override suspend fun backendLogFile(): LogFileDto? = unused()
        override suspend fun refreshProfile(): ProfileDto? = unused()
        override suspend fun transcriptionModels(directory: String?): List<SpeechModelDto> = unused()
        override suspend fun transcribe(directory: String?, request: SpeechRequestDto): SpeechResultDto = unused()
        override suspend fun startLogin(directory: String?): DeviceAuthDto = unused()
        override suspend fun completeLogin(directory: String?): ProfileSyncDto = unused()
        override suspend fun logout(): Boolean = unused()
        override suspend fun setOrganization(organizationId: String?): ProfileSyncDto = unused()
        override suspend fun refreshAccount(): ProfileSyncDto = unused()
        override suspend fun captureTelemetry(capture: TelemetryCaptureDto): Unit = unused()

        private fun unused(): Nothing = error("unused in retention harness")

        private companion object {
            const val USER = "kilo"
            val JSON = "application/json".toMediaType()
        }
    }

    /**
     * Locks the config file the instant the policy is enabled, then counts the writes that try to put
     * the disabled policy back.
     *
     * Locking before the call cannot work: [KiloAppService.runManualRetention] writes the enabling
     * patch first, so a file that is already read-only fails that write and reports
     * [ManualRetentionResult.NotStarted] instead of the restore failure under test.
     */
    private class LockAfterEnable(
        port: Int,
        password: String,
        private val configFile: File,
    ) : HttpAppApi(port, password) {
        /** Armed by the test after its own setup writes, so only the service's enabling write locks. */
        var lockOnEnable = false

        val restoreWrites = AtomicInteger()

        override suspend fun updateConfig(patch: ConfigPatchDto): KiloAppStateDto {
            if (patch.retention?.enabled == false) restoreWrites.incrementAndGet()
            val state = super.updateConfig(patch)
            if (lockOnEnable && patch.retention?.enabled == true) {
                assertTrue(configFile.setWritable(false), "could not make ${configFile.absolutePath} read-only")
                assertFalse(configFile.canWrite(), "the config file is still writable, so the restore cannot fail")
                println("[e2e] made ${configFile.absolutePath} read-only after enabling retention")
            }
            return state
        }
    }

    /** Wire shapes of `GET /kilocode/retention`, decoded locally instead of through a shared DTO. */
    @Serializable
    private data class WireStatus(
        val policy: WirePolicy = WirePolicy(),
    ) {
        fun toDto() = RetentionStatusDto(
            policy = RetentionPolicyDto(policy.enabled, policy.maxAgeDays),
        )
    }

    @Serializable
    private data class WirePolicy(
        val enabled: Boolean = false,
        val maxAgeDays: Int = 30,
    )
}
