@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.rpc.KiloAgentBehaviorRpcApi
import com.intellij.platform.rpc.backend.RemoteApiProvider
import fleet.rpc.remoteApiDescriptor

internal class KiloAgentBehaviorRpcApiProvider : RemoteApiProvider {
    private val api = KiloAgentBehaviorRpcApiImpl()
    override fun RemoteApiProvider.Sink.remoteApis() {
        remoteApi(remoteApiDescriptor<KiloAgentBehaviorRpcApi>()) {
            api
        }
    }
}
