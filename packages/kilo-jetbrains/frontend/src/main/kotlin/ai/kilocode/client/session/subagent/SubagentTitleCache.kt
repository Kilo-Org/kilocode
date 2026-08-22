package ai.kilocode.client.session.subagent

import com.intellij.openapi.components.Service
import com.intellij.util.concurrency.annotations.RequiresEdt

private const val CAP = 128

@Service(Service.Level.APP)
class SubagentTitleCache {
    // Access-order LRU so high-churn sub-agent session ids evict oldest-used first.
    private val names = object : LinkedHashMap<String, String>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>) = size > CAP
    }

    @RequiresEdt
    fun put(sessionId: String, title: String) {
        names[sessionId] = title
    }

    @RequiresEdt
    fun title(sessionId: String): String? = names[sessionId]

    @RequiresEdt
    fun clear() {
        names.clear()
    }
}
