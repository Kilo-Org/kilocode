package ai.kilocode.client.vfs

import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import java.util.concurrent.ConcurrentHashMap

@Service(Service.Level.APP)
class KiloEditorKindRegistry {
    private val kinds = ConcurrentHashMap<String, KiloEditorKind>()

    fun register(kind: KiloEditorKind) {
        kinds[kind.id] = kind
        service<KiloVirtualFileKindRegistry>().register(kind)
    }

    fun unregister(id: String) {
        kinds.remove(id)
        service<KiloVirtualFileKindRegistry>().unregister(id)
    }

    fun clear() {
        kinds.keys.forEach { id -> unregister(id) }
    }

    fun get(id: String): KiloEditorKind? = kinds[id]
}
