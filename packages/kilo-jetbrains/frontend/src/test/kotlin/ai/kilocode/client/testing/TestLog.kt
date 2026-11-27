package ai.kilocode.client.testing

import ai.kilocode.log.KiloLog

class TestLog : KiloLog {
    private val items = mutableListOf<String>()
    private val lock = Object()
    val messages: List<String>
        get() = synchronized(lock) { items.toList() }
    override var isDebugEnabled: Boolean = true

    fun awaitMessage(timeout: Long = 5_000, predicate: (String) -> Boolean): Boolean {
        val end = System.currentTimeMillis() + timeout
        synchronized(lock) {
            while (items.none(predicate)) {
                val wait = end - System.currentTimeMillis()
                if (wait <= 0) return false
                lock.wait(wait)
            }
            return true
        }
    }

    override fun debug(block: () -> String) {
        if (!isDebugEnabled) return
        add("DEBUG: ${block()}")
    }

    override fun info(msg: String) {
        add("INFO: $msg")
    }

    override fun warn(msg: String, t: Throwable?) {
        add("WARN: $msg")
    }

    override fun error(msg: String, t: Throwable?) {
        add("ERROR: $msg")
    }

    private fun add(msg: String) {
        synchronized(lock) {
            items.add(msg)
            lock.notifyAll()
        }
    }
}
