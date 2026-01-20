package ai.kilocode.jetbrains.monitoring

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import java.util.concurrent.ConcurrentHashMap

/**
 * Tracks disposable resources to ensure proper cleanup
 * Helps prevent resource leaks by maintaining a registry of active disposables
 */
object DisposableTracker {
    private val logger = Logger.getInstance(DisposableTracker::class.java)
    private val disposables = ConcurrentHashMap<String, Disposable>()
    
    /**
     * Register a disposable resource for tracking
     * @param name Unique identifier for the disposable
     * @param disposable The disposable resource to track
     */
    fun register(name: String, disposable: Disposable) {
        disposables[name] = disposable
        logger.info("Registered disposable: $name (total: ${disposables.size})")
    }
    
    /**
     * Unregister a disposable resource after it has been disposed
     * @param name Unique identifier of the disposable
     */
    fun unregister(name: String) {
        disposables.remove(name)
        logger.info("Unregistered disposable: $name (remaining: ${disposables.size})")
    }
    
    /**
     * Get the set of currently active disposable names
     * @return Set of active disposable identifiers
     */
    fun getActiveDisposables(): Set<String> {
        return disposables.keys.toSet()
    }
    
    /**
     * Log all currently active disposables
     * Useful for debugging resource leaks
     */
    fun logActiveDisposables() {
        val active = getActiveDisposables()
        logger.info("Active disposables (${active.size} total):")
        active.forEach { logger.info("  $it") }
    }
    
    /**
     * Dispose all tracked resources
     * Should only be used during emergency shutdown or testing
     */
    fun disposeAll() {
        logger.warn("Disposing all tracked resources (${disposables.size} total)")
        try {
            disposables.forEach { (name, disposable) ->
                try {
                    disposable.dispose()
                    logger.info("Disposed: $name")
                } catch (e: Exception) {
                    logger.error("Failed to dispose $name", e)
                }
            }
        } finally {
            // Always clear the registry, even if an error occurred during disposal
            disposables.clear()
        }
    }
    
    /**
     * Get the count of active disposables
     * @return Number of currently tracked disposables
     */
    fun getActiveCount(): Int {
        return disposables.size
    }
}
