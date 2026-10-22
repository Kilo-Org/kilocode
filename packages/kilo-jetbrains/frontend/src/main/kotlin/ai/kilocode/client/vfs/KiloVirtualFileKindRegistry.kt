package ai.kilocode.client.vfs

import com.intellij.openapi.components.Service
import java.util.concurrent.ConcurrentHashMap

@Service(Service.Level.APP)
class KiloVirtualFileKindRegistry {
    private val kinds = ConcurrentHashMap<String, KiloVirtualFileKind>()

    fun register(kind: KiloVirtualFileKind) {
        kinds[kind.id] = kind
    }

    fun unregister(id: String) {
        kinds.remove(id)
    }

    fun clear() {
        kinds.clear()
    }

    fun get(id: String): KiloVirtualFileKind? = kinds[id]
}
