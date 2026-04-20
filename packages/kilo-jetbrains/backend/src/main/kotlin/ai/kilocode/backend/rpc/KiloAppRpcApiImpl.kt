@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.app.LoadError
import ai.kilocode.backend.app.LoadProgress
import ai.kilocode.backend.app.ProfileResult
import ai.kilocode.rpc.KiloAppRpcApi
import ai.kilocode.rpc.dto.HealthDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.LoadErrorDto
import ai.kilocode.rpc.dto.LoadProgressDto
import ai.kilocode.rpc.dto.ProfileStatusDto
import com.intellij.openapi.components.service
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/**
 * Backend implementation of [KiloAppRpcApi].
 *
 * Delegates directly to the app-level [KiloBackendAppService] —
 * no project resolution needed since all operations are app-scoped.
 */
class KiloAppRpcApiImpl : KiloAppRpcApi {

    private val app: KiloBackendAppService get() = service()

    override suspend fun connect() = app.connect()

    override suspend fun state(): Flow<KiloAppStateDto> =
        app.appState.map(::dto).distinctUntilChanged()

    override suspend fun health(): HealthDto = app.health()

    override suspend fun restart() = app.restart()

    override suspend fun reinstall() = app.reinstall()

    private fun dto(state: KiloAppState): KiloAppStateDto =
        when (state) {
            KiloAppState.Disconnected -> KiloAppStateDto(KiloAppStatusDto.DISCONNECTED)
            KiloAppState.Connecting -> KiloAppStateDto(KiloAppStatusDto.CONNECTING)
            is KiloAppState.Loading -> KiloAppStateDto(
                status = KiloAppStatusDto.LOADING,
                progress = progress(state.progress),
            )
            is KiloAppState.Ready -> KiloAppStateDto(
                status = KiloAppStatusDto.READY,
                progress = LoadProgressDto(
                    config = true,
                    notifications = true,
                    profile = if (state.data.profile != null) ProfileStatusDto.LOADED
                        else ProfileStatusDto.NOT_LOGGED_IN,
                ),
            )
            is KiloAppState.Error -> KiloAppStateDto(
                status = KiloAppStatusDto.ERROR,
                error = state.message,
                errors = state.errors.map(::error),
            )
        }

    private fun progress(p: LoadProgress) = LoadProgressDto(
        config = p.config,
        notifications = p.notifications,
        profile = when (p.profile) {
            ProfileResult.PENDING -> ProfileStatusDto.PENDING
            ProfileResult.LOADED -> ProfileStatusDto.LOADED
            ProfileResult.NOT_LOGGED_IN -> ProfileStatusDto.NOT_LOGGED_IN
        },
    )

    private fun error(e: LoadError) = LoadErrorDto(
        resource = e.resource,
        status = e.status,
        detail = e.detail,
    )
}
