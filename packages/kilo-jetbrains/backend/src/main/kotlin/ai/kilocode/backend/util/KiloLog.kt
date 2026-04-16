package ai.kilocode.backend.util

import com.intellij.openapi.diagnostic.Logger

interface KiloLog {
    fun debug(msg: String)
    fun info(msg: String)
    fun warn(msg: String, t: Throwable? = null)
    fun error(msg: String, t: Throwable? = null)
}

internal class IntellijLog(cls: Class<*>) : KiloLog {
    private val delegate = Logger.getInstance(cls)
    override fun debug(msg: String) = delegate.debug(msg)
    override fun info(msg: String) = delegate.info(msg)
    override fun warn(msg: String, t: Throwable?) {
        if (t != null) delegate.warn(msg, t) else delegate.warn(msg)
    }
    override fun error(msg: String, t: Throwable?) {
        if (t != null) delegate.error(msg, t) else delegate.error(msg)
    }
}
