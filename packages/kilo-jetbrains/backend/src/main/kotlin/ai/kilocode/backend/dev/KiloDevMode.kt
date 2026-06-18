package ai.kilocode.backend.dev

import ai.kilocode.log.KiloLog

object KiloDevMode {
    fun enabled(): Boolean = KiloLog.sandbox()
}
