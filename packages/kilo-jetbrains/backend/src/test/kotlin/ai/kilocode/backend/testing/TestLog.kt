package ai.kilocode.backend.testing

import ai.kilocode.log.KiloLog

/**
 * Test logger that captures messages for assertions and prints to stdout.
 */
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
        val msg = block()
        add("DEBUG: $msg")
        println("[test] DEBUG: $msg")
    }

    override fun info(msg: String) {
        add("INFO: $msg")
        println("[test] INFO: $msg")
    }

    override fun warn(msg: String, t: Throwable?) {
        add("WARN: $msg")
        println("[test] WARN: $msg")
        t?.printStackTrace()
    }

    override fun error(msg: String, t: Throwable?) {
        add("ERROR: $msg")
        System.err.println("[test] ERROR: $msg")
        t?.printStackTrace()
    }

    private fun add(msg: String) {
        synchronized(lock) {
            items.add(msg)
            lock.notifyAll()
        }
    }
}
