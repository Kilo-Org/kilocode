package ai.kilocode.rpc

import ai.kilocode.rpc.dto.HostedProviderDto
import ai.kilocode.rpc.dto.HostedSystemEventDto
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceListDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor
import kotlinx.coroutines.flow.Flow

/**
 * Provider-neutral hosted Cloud workspace discovery, entirely through the local `kilo serve`
 * Session Host. No provider origin, credential, or Cloud transport is exposed here.
 */
@Rpc
interface KiloHostedRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloHostedRpcApi =
            RemoteApiProviderService.resolve(remoteApiDescriptor<KiloHostedRpcApi>())
    }

    /** Hosted providers and their current availability. Signed out is a state, not an error. */
    suspend fun providers(): List<HostedProviderDto>

    /**
     * Authorized workspaces for [repositoryUrl]. [cursor] pages workspaces; each workspace carries
     * its first page of root sessions and a [HostedWorkspaceDto.sessionCursor] for further pages.
     */
    suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?): HostedWorkspaceListDto

    /** One workspace with a page of root sessions. */
    suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?): HostedWorkspaceDto

    /** Passive compute/billing status. Reads never wake compute. */
    suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?): HostedWorkspaceStatusDto

    /**
     * Decoded preparation/cloud/sandbox status for one attached hosted session. [sessionID] is the
     * provider-native session ID, not its composite hosted identity.
     */
    suspend fun systemEvents(ref: HostedWorkspaceRefDto, sessionID: String, organizationID: String?): Flow<HostedSystemEventDto>
}
