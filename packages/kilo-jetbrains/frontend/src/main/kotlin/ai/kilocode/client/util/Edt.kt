package ai.kilocode.client.util

import com.intellij.openapi.application.ApplicationManager

internal fun edt(block: () -> Unit) {
    val app = ApplicationManager.getApplication()
    if (app.isDispatchThread) {
        block()
        return
    }
    app.invokeLater(block)
}

internal fun edt(alive: () -> Boolean, block: () -> Unit) {
    if (!alive()) return
    val app = ApplicationManager.getApplication()
    if (app.isDispatchThread) {
        if (alive()) block()
        return
    }
    app.invokeLater {
        if (alive()) block()
    }
}

internal fun edtLater(block: () -> Unit) {
    ApplicationManager.getApplication().invokeLater(block)
}

internal fun <T> edtWait(block: () -> T): T {
    val app = ApplicationManager.getApplication()
    if (app.isDispatchThread) return block()
    var out: T? = null
    app.invokeAndWait { out = block() }
    @Suppress("UNCHECKED_CAST")
    return out as T
}
