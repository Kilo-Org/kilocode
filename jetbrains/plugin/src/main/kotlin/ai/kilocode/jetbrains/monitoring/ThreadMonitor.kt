package ai.kilocode.jetbrains.monitoring

import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.lang.management.ManagementFactory

class ThreadMonitor {
    private val logger = Logger.getInstance(ThreadMonitor::class.java)
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private var isMonitoring = false
    
    companion object {
        private const val CHECK_INTERVAL_MS = 60000L // 1 minute
        private const val WARNING_THRESHOLD = 500
        private const val CRITICAL_THRESHOLD = 1000
    }
    
    fun startMonitoring() {
        if (isMonitoring) return
        isMonitoring = true
        
        scope.launch {
            while (isActive) {
                checkThreadCount()
                logMemoryUsage()
                delay(CHECK_INTERVAL_MS)
            }
        }
        
        logger.info("Thread monitoring started")
    }
    
    fun checkThreadCount() {
        val threadCount = Thread.activeCount()
        val threadMXBean = ManagementFactory.getThreadMXBean()
        val peakThreadCount = threadMXBean.peakThreadCount
        
        logger.info("Thread count: $threadCount (peak: $peakThreadCount)")
        
        when {
            threadCount > CRITICAL_THRESHOLD -> {
                logger.error("CRITICAL: Thread count exceeded $CRITICAL_THRESHOLD: $threadCount")
                dumpThreadInfo()
            }
            threadCount > WARNING_THRESHOLD -> {
                logger.warn("WARNING: High thread count detected: $threadCount")
            }
        }
    }
    
    private fun dumpThreadInfo() {
        val threadMXBean = ManagementFactory.getThreadMXBean()
        val threadInfo = threadMXBean.dumpAllThreads(false, false)
        
        val threadsByName = threadInfo.groupBy { it.threadName.substringBefore("-") }
        logger.warn("Thread breakdown:")
        threadsByName.forEach { (name, threads) ->
            logger.warn("  $name: ${threads.size} threads")
        }
    }
    
    fun getThreadStats(): ThreadStats {
        val threadMXBean = ManagementFactory.getThreadMXBean()
        return ThreadStats(
            activeCount = Thread.activeCount(),
            peakCount = threadMXBean.peakThreadCount,
            totalStarted = threadMXBean.totalStartedThreadCount
        )
    }
    
    fun logMemoryUsage() {
        val runtime = Runtime.getRuntime()
        val usedMemory = (runtime.totalMemory() - runtime.freeMemory()) / 1024 / 1024
        val maxMemory = runtime.maxMemory() / 1024 / 1024
        val threadCount = Thread.activeCount()
        
        logger.info("Memory: ${usedMemory}MB / ${maxMemory}MB, Threads: $threadCount")
    }
    
    fun dispose() {
        isMonitoring = false
        scope.cancel()
        logger.info("Thread monitoring stopped")
    }
}

data class ThreadStats(
    val activeCount: Int,
    val peakCount: Int,
    val totalStarted: Long
)
