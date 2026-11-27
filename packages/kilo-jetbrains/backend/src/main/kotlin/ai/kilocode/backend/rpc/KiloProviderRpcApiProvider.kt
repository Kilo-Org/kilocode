@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.rpc.KiloProviderRpcApi
import com.intellij.platform.rpc.backend.RemoteApiProvider
import fleet.rpc.remoteApiDescriptor

internal class KiloProviderRpcApiProvider : RemoteApiProvider {
    private val api = KiloProviderRpcApiImpl()
    override fun RemoteApiProvider.Sink.remoteApis() {
        remoteApi(remoteApiDescriptor<KiloProviderRpcApi>()) {
            api
        }
    }
}
