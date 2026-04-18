@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.rpc.KiloSessionRpcApi
import com.intellij.platform.rpc.backend.RemoteApiProvider
import fleet.rpc.remoteApiDescriptor

internal class KiloSessionRpcApiProvider : RemoteApiProvider {
    override fun RemoteApiProvider.Sink.remoteApis() {
        remoteApi(remoteApiDescriptor<KiloSessionRpcApi>()) {
            KiloSessionRpcApiImpl()
        }
    }
}
