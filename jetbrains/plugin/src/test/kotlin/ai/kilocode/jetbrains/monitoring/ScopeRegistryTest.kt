package ai.kilocode.jetbrains.monitoring

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Test suite for ScopeRegistry to validate coroutine scope tracking
 * and lifecycle management.
 */
class ScopeRegistryTest {
    
    @After
    fun cleanup() {
        // Clear registry after each test to prevent interference
        ScopeRegistry.getActiveScopes().keys.forEach { 
            ScopeRegistry.unregister(it) 
        }
    }
    
    /**
     * Verifies that scopes can be registered and tracked correctly.
     * This is essential for monitoring active coroutine scopes.
     */
    @Test
    fun `should register and track scope`() {
        val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
        ScopeRegistry.register("test-scope", scope)
        
        val activeScopes = ScopeRegistry.getActiveScopes()
        assertTrue("Scope should be registered", activeScopes.containsKey("test-scope"))
        assertTrue("Scope should be active", activeScopes["test-scope"] == true)
        
        scope.cancel()
    }
    
    /**
     * Validates that scopes can be unregistered from the registry.
     * Proper unregistration prevents memory leaks.
     */
    @Test
    fun `should unregister scope`() {
        val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
        ScopeRegistry.register("test-scope", scope)
        ScopeRegistry.unregister("test-scope")
        
        val activeScopes = ScopeRegistry.getActiveScopes()
        assertFalse("Scope should be unregistered", activeScopes.containsKey("test-scope"))
        
        scope.cancel()
    }
    
    /**
     * Tests that the registry correctly tracks scope active status.
     * This helps identify scopes that haven't been properly cancelled.
     */
    @Test
    fun `should track scope active status`() {
        val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
        ScopeRegistry.register("test-scope", scope)
        
        assertTrue(
            "Scope should be active initially",
            ScopeRegistry.getActiveScopes()["test-scope"] == true
        )
        
        scope.cancel()
        
        // After cancellation, scope should be inactive
        assertFalse(
            "Scope should be inactive after cancellation",
            ScopeRegistry.getActiveScopes()["test-scope"] == true
        )
    }
    
    /**
     * Ensures multiple scopes can be registered simultaneously.
     * This validates the registry can handle concurrent scope management.
     */
    @Test
    fun `should handle multiple scopes`() {
        val scope1 = CoroutineScope(Dispatchers.Default + SupervisorJob())
        val scope2 = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val scope3 = CoroutineScope(Dispatchers.Default + SupervisorJob())
        
        ScopeRegistry.register("scope-1", scope1)
        ScopeRegistry.register("scope-2", scope2)
        ScopeRegistry.register("scope-3", scope3)
        
        val activeScopes = ScopeRegistry.getActiveScopes()
        assertTrue("Should have at least 3 scopes registered", activeScopes.size >= 3)
        assertTrue("Scope 1 should be registered", activeScopes.containsKey("scope-1"))
        assertTrue("Scope 2 should be registered", activeScopes.containsKey("scope-2"))
        assertTrue("Scope 3 should be registered", activeScopes.containsKey("scope-3"))
        
        scope1.cancel()
        scope2.cancel()
        scope3.cancel()
    }
    
    /**
     * Tests that re-registering a scope with the same name replaces the old one.
     * This prevents duplicate entries in the registry.
     */
    @Test
    fun `should replace scope on re-registration`() {
        val scope1 = CoroutineScope(Dispatchers.Default + SupervisorJob())
        val scope2 = CoroutineScope(Dispatchers.IO + SupervisorJob())
        
        ScopeRegistry.register("test-scope", scope1)
        ScopeRegistry.register("test-scope", scope2)
        
        val activeScopes = ScopeRegistry.getActiveScopes()
        assertTrue("Scope should be registered", activeScopes.containsKey("test-scope"))
        
        // Cancel the first scope - registry should still show active (because scope2 is active)
        scope1.cancel()
        assertTrue(
            "Scope should still be active (scope2)",
            ScopeRegistry.getActiveScopes()["test-scope"] == true
        )
        
        scope2.cancel()
    }
    
    /**
     * Validates that logScopeStatus doesn't throw exceptions.
     * This method is used for debugging and monitoring.
     */
    @Test
    fun `should log scope status without errors`() {
        val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
        ScopeRegistry.register("test-scope", scope)
        
        ScopeRegistry.logScopeStatus()
        // Should not throw - test passes if no exception
        assertTrue("Scope status logged successfully", true)
        
        scope.cancel()
    }
}
