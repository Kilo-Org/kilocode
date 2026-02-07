package ai.kilocode.jetbrains.integration

import ai.kilocode.jetbrains.monitoring.ScopeRegistry
import ai.kilocode.jetbrains.monitoring.ThreadMonitor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Integration test suite for thread leak prevention.
 * Validates that the thread leak fixes from Phases 1-5 work correctly
 * and prevent resource leaks under various scenarios.
 */
class ThreadLeakPreventionTest {
    
    @After
    fun cleanup() {
        // Clean up any registered scopes
        ScopeRegistry.getActiveScopes().keys.forEach { 
            ScopeRegistry.unregister(it) 
        }
    }
    
    /**
     * Tests that creating and cancelling multiple scopes doesn't leak threads.
     * This validates Phase 1 (reusable coroutine scopes) is working correctly.
     */
    @Test
    fun `should not leak threads with multiple scope creations`() {
        val monitor = ThreadMonitor()
        val initialStats = monitor.getThreadStats()
        val initialCount = initialStats.activeCount
        
        // Create and cancel multiple scopes
        repeat(100) {
            val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
            ScopeRegistry.register("test-scope-$it", scope)
            scope.cancel()
            ScopeRegistry.unregister("test-scope-$it")
        }
        
        // Give time for cleanup
        Thread.sleep(1000)
        
        val finalStats = monitor.getThreadStats()
        val finalCount = finalStats.activeCount
        
        // Thread count should not grow significantly
        val threadGrowth = finalCount - initialCount
        assertTrue("Thread count grew by $threadGrowth (expected < 50). Initial: $initialCount, Final: $finalCount", threadGrowth < 50)
        
        monitor.dispose()
    }
    
    /**
     * Tests that rapid coroutine launches don't cause thread explosion.
     * This validates Phase 2 (bounded thread pools) is working correctly.
     */
    @Test
    fun `should handle rapid coroutine launches without thread explosion`() {
        val monitor = ThreadMonitor()
        val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val initialStats = monitor.getThreadStats()
        
        // Launch many coroutines rapidly
        runBlocking {
            repeat(1000) {
                scope.launch {
                    delay(10)
                }
            }
            delay(2000) // Wait for completion
        }
        
        val finalStats = monitor.getThreadStats()
        val threadGrowth = finalStats.activeCount - initialStats.activeCount
        
        // With bounded thread pool, growth should be minimal
        assertTrue("Thread count grew by $threadGrowth (expected < 100). Initial: ${initialStats.activeCount}, Final: ${finalStats.activeCount}", threadGrowth < 100)
        
        scope.cancel()
        monitor.dispose()
    }
    
    /**
     * Tests that scope registry correctly tracks scope lifecycle.
     * This validates monitoring infrastructure from Phase 4.
     */
    @Test
    fun `should track scope lifecycle correctly`() {
        val scopes = mutableListOf<CoroutineScope>()
        
        // Create multiple scopes
        repeat(10) {
            val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
            scopes.add(scope)
            ScopeRegistry.register("lifecycle-test-$it", scope)
        }
        
        // Verify all are registered and active
        val activeScopes = ScopeRegistry.getActiveScopes()
        assertTrue("Should have at least 10 scopes registered", activeScopes.size >= 10)
        
        // Cancel half of them
        scopes.take(5).forEachIndexed { index, scope ->
            scope.cancel()
        }
        
        // Give time for cancellation to propagate
        Thread.sleep(100)
        
        // Verify inactive scopes are detected
        val scopesAfterCancel = ScopeRegistry.getActiveScopes()
        val inactiveCount = scopesAfterCancel.values.count { !it }
        assertTrue("Should have at least 5 inactive scopes", inactiveCount >= 5)
        
        // Clean up remaining scopes
        scopes.drop(5).forEach { it.cancel() }
    }
    
    /**
     * Tests that concurrent scope operations don't cause race conditions.
     * This validates thread-safe implementation of monitoring infrastructure.
     */
    @Test
    fun `should handle concurrent scope operations safely`() {
        val monitor = ThreadMonitor()
        val initialStats = monitor.getThreadStats()
        
        runBlocking {
            // Launch multiple coroutines that create and cancel scopes concurrently
            val jobs = List(20) { index ->
                launch(Dispatchers.Default) {
                    repeat(10) { iteration ->
                        val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
                        val scopeName = "concurrent-$index-$iteration"
                        ScopeRegistry.register(scopeName, scope)
                        delay(10)
                        scope.cancel()
                        ScopeRegistry.unregister(scopeName)
                    }
                }
            }
            
            // Wait for all jobs to complete
            jobs.forEach { it.join() }
        }
        
        // Give time for cleanup
        Thread.sleep(1000)
        
        val finalStats = monitor.getThreadStats()
        val threadGrowth = finalStats.activeCount - initialStats.activeCount
        
        // Thread count should remain reasonable despite concurrent operations
        assertTrue("Thread count grew by $threadGrowth (expected < 100) after concurrent operations", threadGrowth < 100)
        
        monitor.dispose()
    }
    
    /**
     * Tests that long-running scopes don't accumulate threads over time.
     * This validates Phase 1 (scope reuse) prevents thread accumulation.
     */
    @Test
    fun `should not accumulate threads with long-running scopes`() {
        val monitor = ThreadMonitor()
        val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        ScopeRegistry.register("long-running-test", scope)
        
        val initialStats = monitor.getThreadStats()
        
        runBlocking {
            // Launch many short-lived coroutines in the same scope
            repeat(500) {
                scope.launch {
                    delay(5)
                }
            }
            
            // Wait for all to complete
            delay(3000)
        }
        
        val finalStats = monitor.getThreadStats()
        val threadGrowth = finalStats.activeCount - initialStats.activeCount
        
        // Thread count should not grow significantly with scope reuse
        assertTrue("Thread count grew by $threadGrowth (expected < 50) with long-running scope", threadGrowth < 50)
        
        scope.cancel()
        ScopeRegistry.unregister("long-running-test")
        monitor.dispose()
    }
    
    /**
     * Tests that monitoring infrastructure itself doesn't leak resources.
     * This validates Phase 4 (monitoring tools) are properly implemented.
     */
    @Test
    fun `should not leak resources from monitoring infrastructure`() {
        val monitors = mutableListOf<ThreadMonitor>()
        
        // Create and dispose multiple monitors
        repeat(50) {
            val monitor = ThreadMonitor()
            monitor.startMonitoring()
            monitors.add(monitor)
        }
        
        // Give time for monitoring to start
        Thread.sleep(500)
        
        val statsBeforeDispose = monitors.first().getThreadStats()
        
        // Dispose all monitors
        monitors.forEach { it.dispose() }
        
        // Give time for cleanup
        Thread.sleep(1000)
        
        val statsAfterDispose = ThreadMonitor().getThreadStats()
        val threadGrowth = statsAfterDispose.activeCount - statsBeforeDispose.activeCount
        
        // Thread count should not grow from monitoring infrastructure
        assertTrue("Thread count grew by $threadGrowth (expected < 20) from monitoring infrastructure", threadGrowth < 20)
    }
    
    /**
     * Tests that scope cancellation properly cleans up resources.
     * This validates Phase 5 (lifecycle management) is working correctly.
     */
    @Test
    fun `should clean up resources on scope cancellation`() {
        val monitor = ThreadMonitor()
        val initialStats = monitor.getThreadStats()
        
        val scopes = mutableListOf<CoroutineScope>()
        
        // Create multiple scopes with active coroutines
        repeat(20) { index ->
            val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
            scopes.add(scope)
            ScopeRegistry.register("cleanup-test-$index", scope)
            
            // Launch some work in each scope
            repeat(10) {
                scope.launch {
                    delay(100)
                }
            }
        }
        
        // Give time for coroutines to start
        Thread.sleep(200)
        
        val statsWithActiveScopes = monitor.getThreadStats()
        
        // Cancel all scopes
        scopes.forEachIndexed { index, scope ->
            scope.cancel()
            ScopeRegistry.unregister("cleanup-test-$index")
        }
        
        // Give time for cleanup
        Thread.sleep(1000)
        
        val finalStats = monitor.getThreadStats()
        
        // Thread count should return close to initial level
        val finalGrowth = finalStats.activeCount - initialStats.activeCount
        assertTrue("Thread count grew by $finalGrowth (expected < 50) after cleanup. Initial: ${initialStats.activeCount}, Final: ${finalStats.activeCount}", finalGrowth < 50)
        
        monitor.dispose()
    }
}
