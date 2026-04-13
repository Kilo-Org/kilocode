@file:Suppress("UnstableApiUsage")

package ai.kilocode.rpc

import com.intellij.platform.rpc.backend.RemoteApiProvider
import fleet.rpc.remoteApiDescriptor

internal class KiloProjectRpcApiProvider : RemoteApiProvider {
    override fun RemoteApiProvider.Sink.remoteApis() {
        remoteApi(remoteApiDescriptor<KiloProjectRpcApi>()) {
            KiloProjectRpcApiImpl()
        }
    }
}
