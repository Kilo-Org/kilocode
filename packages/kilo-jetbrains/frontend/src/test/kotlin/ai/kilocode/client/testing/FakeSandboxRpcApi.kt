package ai.kilocode.client.testing

import ai.kilocode.rpc.KiloSandboxRpcApi
import ai.kilocode.rpc.dto.SandboxStatusDto
import ai.kilocode.rpc.dto.SandboxSupportDto
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow

/**
 * Fake [KiloSandboxRpcApi] for testing. Configurable return values and call tracking. Push
 * `sandbox.status.changed` events via [events].
 */
class FakeSandboxRpcApi : KiloSandboxRpcApi {
    /** Result of [support], keyed by directory; falls back to [defaultSupport]. */
    val supportByDirectory = mutableMapOf<String, SandboxSupportDto>()
    var defaultSupport = SandboxSupportDto(available = true)

    /** Result of [status], keyed by "sessionID/directory"; falls back to [defaultStatus]. */
    val statusByKey = mutableMapOf<String, SandboxStatusDto>()
    var defaultStatus: (String, String) -> SandboxStatusDto =
        { sessionID, directory -> SandboxStatusDto(sessionID, directory, enabled = false, available = true, version = 0) }

    val setEnabledCalls = mutableListOf<Triple<String, String, Boolean>>()
    var setEnabledThrows: Exception? = null

    /** Overrides the result of [setEnabled]; defaults to re-reading [status]/[statusByKey]. */
    var setEnabledResult: ((String, String, Boolean) -> SandboxStatusDto)? = null

    val events = MutableSharedFlow<SandboxStatusDto>(extraBufferCapacity = 16)

    override suspend fun support(directory: String): SandboxSupportDto =
        supportByDirectory[directory] ?: defaultSupport

    override suspend fun status(sessionID: String, directory: String): SandboxStatusDto =
        statusByKey["$sessionID/$directory"] ?: defaultStatus(sessionID, directory)

    override suspend fun setEnabled(sessionID: String, directory: String, enabled: Boolean): SandboxStatusDto {
        setEnabledCalls.add(Triple(sessionID, directory, enabled))
        setEnabledThrows?.let { throw it }
        val result = setEnabledResult?.invoke(sessionID, directory, enabled)
            ?: status(sessionID, directory).copy(enabled = enabled)
        statusByKey["$sessionID/$directory"] = result
        return result
    }

    override suspend fun statusChanges(): Flow<SandboxStatusDto> = events
}
