package ai.kilocode.client.diff

import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.openapi.components.Service
import java.util.concurrent.ConcurrentHashMap

@Service(Service.Level.PROJECT)
class KiloInlineDiffStore {
    private val items = ConcurrentHashMap<String, List<DiffFileDto>>()

    fun put(token: String, files: List<DiffFileDto>) {
        items[token] = files
    }

    fun get(token: String): List<DiffFileDto>? = items[token]

    fun pop(token: String): List<DiffFileDto>? = items.remove(token)
}
