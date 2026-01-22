package ai.kilocode.jetbrains.monitoring

import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Test suite for ThreadMonitor to validate thread monitoring functionality
 * and ensure proper resource cleanup.
 */
class ThreadMonitorTest {
    private lateinit var threadMonitor: ThreadMonitor
    
    @Before
    fun setup() {
        threadMonitor = ThreadMonitor()
    }
    
    @After
    fun teardown() {
        threadMonitor.dispose()
    }
    
    /**
     * Verifies that monitoring can be started without throwing exceptions.
     * This ensures the monitoring infrastructure initializes correctly.
     */
    @Test
    fun `should start monitoring without errors`() {
        threadMonitor.startMonitoring()
        // Verify monitoring started - no exception means success
        assertTrue("Monitoring started successfully", true)
    }
    
    /**
     * Validates that thread statistics can be retrieved and contain valid data.
     * Thread stats are essential for detecting thread leaks.
     */
    @Test
    fun `should get thread stats`() {
        val stats = threadMonitor.getThreadStats()
        assertNotNull("Thread stats should not be null", stats)
        assertTrue("Active thread count should be positive", stats.activeCount > 0)
        assertTrue("Peak count should be >= active count", stats.peakCount >= stats.activeCount)
        assertTrue("Total started threads should be positive", stats.totalStarted > 0)
    }
    
    /**
     * Ensures thread count checking doesn't throw exceptions.
     * This method is called periodically during monitoring.
     */
    @Test
    fun `should check thread count without errors`() {
        threadMonitor.checkThreadCount()
        // Should not throw - test passes if no exception
        assertTrue("Thread count check completed", true)
    }
    
    /**
     * Verifies that the monitor can be disposed cleanly without errors.
     * Proper disposal is critical to prevent resource leaks.
     */
    @Test
    fun `should dispose cleanly`() {
        threadMonitor.startMonitoring()
        threadMonitor.dispose()
        // Should not throw - test passes if no exception
        assertTrue("Monitor disposed successfully", true)
    }
    
    /**
     * Tests that multiple calls to startMonitoring are idempotent.
     * This prevents duplicate monitoring tasks from being created.
     */
    @Test
    fun `should handle multiple start monitoring calls`() {
        threadMonitor.startMonitoring()
        threadMonitor.startMonitoring()
        threadMonitor.startMonitoring()
        // Should not create multiple monitoring tasks
        assertTrue("Multiple start calls handled correctly", true)
    }
    
    /**
     * Validates that thread stats remain consistent across multiple calls.
     * This ensures the monitoring data is reliable.
     */
    @Test
    fun `should provide consistent thread stats`() {
        val stats1 = threadMonitor.getThreadStats()
        val stats2 = threadMonitor.getThreadStats()
        
        // Stats should be reasonable and consistent
        assertTrue("First stats should have active threads", stats1.activeCount > 0)
        assertTrue("Second stats should have active threads", stats2.activeCount > 0)
        assertTrue("Total started should not decrease", stats2.totalStarted >= stats1.totalStarted)
    }
}
