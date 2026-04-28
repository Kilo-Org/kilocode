package ai.kilocode.backend.testing

import ai.kilocode.log.KiloLog

/**
 * Test logger that captures messages for assertions and prints to stdout.
 */
class TestLog : KiloLog {
    val messages = mutableListOf<String>()
    override var isDebugEnabled: Boolean = true

    override fun debug(block: () -> String) {
        if (!isDebugEnabled) return
        val msg = block()
        synchronized(messages) { messages.add("DEBUG: $msg") }
        println("[test] DEBUG: $msg")
    }

    override fun info(msg: String) {
        synchronized(messages) { messages.add("INFO: $msg") }
        println("[test] INFO: $msg")
    }

    override fun warn(msg: String, t: Throwable?) {
        synchronized(messages) { messages.add("WARN: $msg") }
        println("[test] WARN: $msg")
        t?.printStackTrace()
    }

    override fun error(msg: String, t: Throwable?) {
        synchronized(messages) { messages.add("ERROR: $msg") }
        System.err.println("[test] ERROR: $msg")
        t?.printStackTrace()
    }
}
