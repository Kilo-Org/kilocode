package ai.kilocode.rpc

import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor

@Rpc
interface KiloEditorRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloEditorRpcApi =
            RemoteApiProviderService.resolve(remoteApiDescriptor<KiloEditorRpcApi>())
    }

    suspend fun complete(directory: String, prefix: String, suffix: String, directMistral: Boolean): String

    /** Returns null when the recent conversation doesn't yet identify a clear task. */
    suspend fun branchName(directory: String, sessionId: String): String?
}
