@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.app.KiloBackendSandboxManager
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloSandboxRpcApi
import ai.kilocode.rpc.dto.SandboxStatusDto
import ai.kilocode.rpc.dto.SandboxSupportDto
import com.intellij.openapi.components.service
import kotlinx.coroutines.flow.Flow

/**
 * Backend implementation of [KiloSandboxRpcApi]. Delegates entirely to [KiloBackendSandboxManager].
 */
class KiloSandboxRpcApiImpl internal constructor(
    private val appOverride: KiloBackendAppService? = null,
    private val log: KiloLog = LOG,
) : KiloSandboxRpcApi {
    companion object {
        private val LOG = KiloLog.create(KiloSandboxRpcApiImpl::class.java)
    }

    private val app: KiloBackendAppService
        get() = appOverride ?: service()

    private val sandbox: KiloBackendSandboxManager
        get() = app.sandbox

    override suspend fun support(directory: String): SandboxSupportDto =
        ready { sandbox.support(directory) }

    override suspend fun status(sessionID: String, directory: String): SandboxStatusDto =
        ready { sandbox.status(sessionID, directory) }

    override suspend fun setEnabled(sessionID: String, directory: String, enabled: Boolean): SandboxStatusDto {
        app.requireReady()
        log.info("sandbox set-enabled RPC: session=$sessionID, dir=$directory, enabled=$enabled")
        return sandbox.setEnabled(sessionID, directory, enabled)
    }

    override suspend fun statusChanges(): Flow<SandboxStatusDto> =
        sandbox.statusChanges

    private suspend fun <T> ready(block: suspend () -> T): T {
        app.requireReady()
        return block()
    }
}
