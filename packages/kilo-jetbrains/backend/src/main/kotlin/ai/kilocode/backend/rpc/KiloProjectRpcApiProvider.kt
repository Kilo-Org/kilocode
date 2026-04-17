@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.rpc.KiloWorkspaceRpcApi
import com.intellij.platform.rpc.backend.RemoteApiProvider
import fleet.rpc.remoteApiDescriptor

internal class KiloProjectRpcApiProvider : RemoteApiProvider {
    override fun RemoteApiProvider.Sink.remoteApis() {
        remoteApi(remoteApiDescriptor<KiloWorkspaceRpcApi>()) {
            KiloWorkspaceRpcApiImpl()
        }
    }
}
