@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.rpc.KiloHostedRpcApi
import ai.kilocode.rpc.dto.HostedCreateWorkspaceDto
import ai.kilocode.rpc.dto.HostedDeleteResultDto
import ai.kilocode.rpc.dto.HostedMutationResultDto
import ai.kilocode.rpc.dto.HostedProviderDto
import ai.kilocode.rpc.dto.HostedStartSessionDto
import ai.kilocode.rpc.dto.HostedSystemEventDto
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceListDto
import ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import com.intellij.openapi.components.service
import kotlinx.coroutines.flow.Flow

/**
 * Backend implementation of hosted workspace discovery. All calls cross the local CLI's Session
 * Host and its opaque attachment; nothing here talks to a provider directly.
 */
class KiloHostedRpcApiImpl internal constructor(
    private val appOverride: KiloBackendAppService? = null,
) : KiloHostedRpcApi {
    private val app: KiloBackendAppService
        get() = appOverride ?: service()

    override suspend fun providers(): List<HostedProviderDto> {
        app.requireReady()
        return app.hosted.providers()
    }

    override suspend fun workspaces(
        repositoryUrl: String?,
        cursor: String?,
        organizationID: String?,
    ): HostedWorkspaceListDto {
        app.requireReady()
        return app.hosted.workspaces(repositoryUrl, cursor, organizationID ?: organization())
    }

    override suspend fun workspace(
        ref: HostedWorkspaceRefDto,
        sessionCursor: String?,
        organizationID: String?,
    ): HostedWorkspaceDto {
        app.requireReady()
        return app.hosted.workspace(ref, sessionCursor, organizationID ?: organization())
    }

    override suspend fun workspaceStatus(
        ref: HostedWorkspaceRefDto,
        organizationID: String?,
    ): HostedWorkspaceStatusDto {
        app.requireReady()
        return app.hosted.workspaceStatus(ref, organizationID ?: organization())
    }

    override suspend fun workspaceProfiles(organizationID: String?): HostedWorkspaceProfileListDto {
        app.requireReady()
        return app.hosted.workspaceProfiles(organizationID ?: organization())
    }

    override suspend fun createWorkspace(request: HostedCreateWorkspaceDto): HostedMutationResultDto {
        app.requireReady()
        return app.hosted.createWorkspace(request.copy(organizationID = request.organizationID ?: organization()))
    }

    override suspend fun startWorkspaceSession(
        ref: HostedWorkspaceRefDto,
        request: HostedStartSessionDto,
    ): HostedMutationResultDto {
        app.requireReady()
        return app.hosted.startWorkspaceSession(
            ref,
            request.copy(organizationID = request.organizationID ?: organization()),
        )
    }

    override suspend fun deleteWorkspace(
        ref: HostedWorkspaceRefDto,
        organizationID: String?,
    ): HostedDeleteResultDto {
        app.requireReady()
        return app.hosted.deleteWorkspace(ref, organizationID ?: organization())
    }

    override suspend fun systemEvents(
        ref: HostedWorkspaceRefDto,
        sessionID: String,
        organizationID: String?,
    ): Flow<HostedSystemEventDto> {
        app.requireReady()
        return app.hosted.systemEvents(ref, sessionID, organizationID ?: organization())
    }

    private fun organization(): String? =
        (app.appState.value as? KiloAppState.Ready)?.data?.profile?.currentOrgId
}
