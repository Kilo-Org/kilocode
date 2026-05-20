package ai.kilocode.backend.testing

import ai.kilocode.log.KiloLog

/**
 * Test logger that captures messages for assertions and prints to stdout.
 */
class TestLog : KiloLog {
    private val items = mutableListOf<String>()
    val messages: List<String>
        get() = synchronized(items) { items.toList() }
    override var isDebugEnabled: Boolean = true

    override fun debug(block: () -> String) {
        if (!isDebugEnabled) return
        val msg = block()
        synchronized(items) { items.add("DEBUG: $msg") }
        println("[test] DEBUG: $msg")
    }

    override fun info(msg: String) {
        synchronized(items) { items.add("INFO: $msg") }
        println("[test] INFO: $msg")
    }

    override fun warn(msg: String, t: Throwable?) {
        synchronized(items) { items.add("WARN: $msg") }
        println("[test] WARN: $msg")
        t?.printStackTrace()
    }

    override fun error(msg: String, t: Throwable?) {
        synchronized(items) { items.add("ERROR: $msg") }
        System.err.println("[test] ERROR: $msg")
        t?.printStackTrace()
    }
}
