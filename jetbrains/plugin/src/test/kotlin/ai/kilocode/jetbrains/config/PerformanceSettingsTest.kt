package ai.kilocode.jetbrains.config

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Test suite for PerformanceSettings to validate configuration values
 * and ensure settings can be modified correctly.
 */
class PerformanceSettingsTest {
    
    // Store original values to restore after tests
    private val originalFileEventDebounce = PerformanceSettings.fileEventDebounceMs
    private val originalEditorActivationDebounce = PerformanceSettings.editorActivationDebounceMs
    private val originalEditorEditDebounce = PerformanceSettings.editorEditDebounceMs
    private val originalMaxConcurrentRpc = PerformanceSettings.maxConcurrentRpcCalls
    
    @After
    fun restoreDefaults() {
        // Restore original values after each test
        PerformanceSettings.fileEventDebounceMs = originalFileEventDebounce
        PerformanceSettings.editorActivationDebounceMs = originalEditorActivationDebounce
        PerformanceSettings.editorEditDebounceMs = originalEditorEditDebounce
        PerformanceSettings.maxConcurrentRpcCalls = originalMaxConcurrentRpc
    }
    
    /**
     * Validates that default values are set correctly.
     * These defaults balance responsiveness and resource usage.
     */
    @Test
    fun `should have correct default values`() {
        assertEquals("File event debounce default", 50L, PerformanceSettings.fileEventDebounceMs)
        assertEquals("Editor activation debounce default", 100L, PerformanceSettings.editorActivationDebounceMs)
        assertEquals("Editor edit debounce default", 50L, PerformanceSettings.editorEditDebounceMs)
        assertEquals("Max concurrent RPC calls default", 100, PerformanceSettings.maxConcurrentRpcCalls)
    }
    
    /**
     * Tests that fileEventDebounceMs can be modified.
     * This setting controls file system event processing rate.
     */
    @Test
    fun `should allow fileEventDebounceMs configuration changes`() {
        val originalValue = PerformanceSettings.fileEventDebounceMs
        
        PerformanceSettings.fileEventDebounceMs = 100L
        assertEquals("Value should be updated to 100", 100L, PerformanceSettings.fileEventDebounceMs)
        
        PerformanceSettings.fileEventDebounceMs = 200L
        assertEquals("Value should be updated to 200", 200L, PerformanceSettings.fileEventDebounceMs)
        
        // Restore original
        PerformanceSettings.fileEventDebounceMs = originalValue
    }
    
    /**
     * Tests that editorActivationDebounceMs can be modified.
     * This setting controls editor switching event processing rate.
     */
    @Test
    fun `should allow editorActivationDebounceMs configuration changes`() {
        val originalValue = PerformanceSettings.editorActivationDebounceMs
        
        PerformanceSettings.editorActivationDebounceMs = 150L
        assertEquals("Value should be updated to 150", 150L, PerformanceSettings.editorActivationDebounceMs)
        
        PerformanceSettings.editorActivationDebounceMs = 250L
        assertEquals("Value should be updated to 250", 250L, PerformanceSettings.editorActivationDebounceMs)
        
        // Restore original
        PerformanceSettings.editorActivationDebounceMs = originalValue
    }
    
    /**
     * Tests that editorEditDebounceMs can be modified.
     * This setting controls typing event processing rate.
     */
    @Test
    fun `should allow editorEditDebounceMs configuration changes`() {
        val originalValue = PerformanceSettings.editorEditDebounceMs
        
        PerformanceSettings.editorEditDebounceMs = 75L
        assertEquals("Value should be updated to 75", 75L, PerformanceSettings.editorEditDebounceMs)
        
        PerformanceSettings.editorEditDebounceMs = 125L
        assertEquals("Value should be updated to 125", 125L, PerformanceSettings.editorEditDebounceMs)
        
        // Restore original
        PerformanceSettings.editorEditDebounceMs = originalValue
    }
    
    /**
     * Tests that maxConcurrentRpcCalls can be modified.
     * This setting controls RPC concurrency limits.
     */
    @Test
    fun `should allow maxConcurrentRpcCalls configuration changes`() {
        val originalValue = PerformanceSettings.maxConcurrentRpcCalls
        
        PerformanceSettings.maxConcurrentRpcCalls = 50
        assertEquals("Value should be updated to 50", 50, PerformanceSettings.maxConcurrentRpcCalls)
        
        PerformanceSettings.maxConcurrentRpcCalls = 200
        assertEquals("Value should be updated to 200", 200, PerformanceSettings.maxConcurrentRpcCalls)
        
        // Restore original
        PerformanceSettings.maxConcurrentRpcCalls = originalValue
    }
    
    /**
     * Validates that all debounce values are positive.
     * Negative or zero values would break the debouncing logic.
     */
    @Test
    fun `should have positive debounce values`() {
        assertTrue("File event debounce should be positive", PerformanceSettings.fileEventDebounceMs > 0)
        assertTrue("Editor activation debounce should be positive", PerformanceSettings.editorActivationDebounceMs > 0)
        assertTrue("Editor edit debounce should be positive", PerformanceSettings.editorEditDebounceMs > 0)
    }
    
    /**
     * Validates that maxConcurrentRpcCalls is positive.
     * Zero or negative values would prevent RPC calls.
     */
    @Test
    fun `should have positive maxConcurrentRpcCalls`() {
        assertTrue("Max concurrent RPC calls should be positive", PerformanceSettings.maxConcurrentRpcCalls > 0)
    }
    
    /**
     * Tests that settings can be configured to extreme values.
     * This validates there are no hard-coded limits preventing configuration.
     */
    @Test
    fun `should allow extreme configuration values`() {
        // Test very low values
        PerformanceSettings.fileEventDebounceMs = 1L
        assertEquals("Should allow 1ms debounce", 1L, PerformanceSettings.fileEventDebounceMs)
        
        // Test very high values
        PerformanceSettings.fileEventDebounceMs = 10000L
        assertEquals("Should allow 10s debounce", 10000L, PerformanceSettings.fileEventDebounceMs)
        
        // Test very low RPC limit
        PerformanceSettings.maxConcurrentRpcCalls = 1
        assertEquals("Should allow limit of 1", 1, PerformanceSettings.maxConcurrentRpcCalls)
        
        // Test very high RPC limit
        PerformanceSettings.maxConcurrentRpcCalls = 10000
        assertEquals("Should allow limit of 10000", 10000, PerformanceSettings.maxConcurrentRpcCalls)
    }
}
