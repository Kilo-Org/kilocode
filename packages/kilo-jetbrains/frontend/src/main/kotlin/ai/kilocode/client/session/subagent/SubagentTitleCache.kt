package ai.kilocode.client.session.subagent

import com.intellij.openapi.components.Service
import com.intellij.util.concurrency.annotations.RequiresEdt

@Service(Service.Level.APP)
class SubagentTitleCache {
    private val names = linkedMapOf<String, String>()

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
