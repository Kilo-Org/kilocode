package ai.kilocode.e2e

import com.intellij.driver.sdk.waitFor
import com.intellij.driver.sdk.waitNotNull
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes

/**
 * One named timeout owner per test file. Every wait reports the watchdog name so a stalled
 * assertion points at the driver instead of a bare stack trace.
 */
class Watchdog(val name: String, val timeout: Duration = 5.minutes) {
    fun await(message: String, timeout: Duration = this.timeout, block: () -> Boolean) {
        waitFor(message = "$name: $message", timeout = timeout) {
            runCatching(block).getOrDefault(false)
        }
    }

    fun <T : Any> value(message: String, timeout: Duration = this.timeout, block: () -> T?): T =
        waitNotNull(message = "$name: $message", timeout = timeout, getter = block)
}
