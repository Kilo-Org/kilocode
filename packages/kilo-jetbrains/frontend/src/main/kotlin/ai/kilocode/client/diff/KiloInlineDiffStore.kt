package ai.kilocode.client.diff

import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.openapi.components.Service
import java.util.Collections

/**
 * Hands off the diff payload for a "Open in Diff Viewer" click to the editor that opens for it.
 *
 * Bounded by a small access-ordered LRU: this is a project-level service, so without eviction every
 * click would retain the full patch text of its turn for the IDE session's lifetime. [MAX] entries is
 * ample for the handful of diff editors a user keeps open, and the eldest entry is dropped after that.
 */
@Service(Service.Level.PROJECT)
class KiloInlineDiffStore {
    private val items = Collections.synchronizedMap(
        object : LinkedHashMap<String, List<DiffFileDto>>(16, 0.75f, true) {
            override fun removeEldestEntry(eldest: Map.Entry<String, List<DiffFileDto>>): Boolean = size > MAX
        },
    )

    fun put(token: String, files: List<DiffFileDto>) {
        items[token] = files
    }

    fun get(token: String): List<DiffFileDto>? = items[token]

    fun pop(token: String): List<DiffFileDto>? = items.remove(token)

    private companion object {
        const val MAX = 32
    }
}
