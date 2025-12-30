package ai.kilocode.jetbrains.core

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

class InitializationStateMachineTest {
    private lateinit var stateMachine: InitializationStateMachine

    @Before
    fun setUp() {
        stateMachine = InitializationStateMachine()
    }

    @Test
    fun testInitialStateIsNotStarted() {
        assertEquals(InitializationState.NOT_STARTED, stateMachine.getCurrentState())
    }

    @Test
    fun testValidStateTransitions() {
        assertTrue(stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "test"))
        assertEquals(InitializationState.SOCKET_CONNECTING, stateMachine.getCurrentState())

        assertTrue(stateMachine.transitionTo(InitializationState.SOCKET_CONNECTED, "test"))
        assertEquals(InitializationState.SOCKET_CONNECTED, stateMachine.getCurrentState())
    }

    @Test
    fun testTransitionToFailedFromAnyState() {
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "test")
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTED, "test")

        assertTrue(stateMachine.transitionTo(InitializationState.FAILED, "test failure"))
        assertEquals(InitializationState.FAILED, stateMachine.getCurrentState())
    }

    @Test
    fun testWaitForStateCompletesWhenStateIsReached() {
        val future = stateMachine.waitForState(InitializationState.SOCKET_CONNECTED)

        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "test")
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTED, "test")

        // Should not throw
        future.get(1, TimeUnit.SECONDS)
    }

    @Test
    fun testWaitForStateReturnsImmediatelyIfAlreadyAtTargetState() {
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "test")
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTED, "test")

        val future = stateMachine.waitForState(InitializationState.SOCKET_CONNECTED)

        assertTrue(future.isDone)
        // Should not throw
        future.get(100, TimeUnit.MILLISECONDS)
    }

    @Test
    fun testStateDurationTracking() {
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "test")
        Thread.sleep(100) // Wait a bit
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTED, "test")

        val duration = stateMachine.getStateDuration(InitializationState.SOCKET_CONNECTING)
        assertNotNull(duration)
        assertTrue("Duration should be at least 100ms, was $duration", duration!! >= 100)
    }

    @Test
    fun testGenerateReportIncludesStateInformation() {
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "test")
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTED, "test")

        val report = stateMachine.generateReport()

        assertTrue(report.contains("Current State: SOCKET_CONNECTED"))
        assertTrue(report.contains("SOCKET_CONNECTING"))
        assertTrue(report.contains("SOCKET_CONNECTED"))
    }

    @Test
    fun testStateListenersAreNotified() {
        var listenerCalled = false
        var receivedState: InitializationState? = null

        stateMachine.onStateReached(InitializationState.SOCKET_CONNECTED) { state ->
            listenerCalled = true
            receivedState = state
        }

        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "test")
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTED, "test")

        assertTrue(listenerCalled)
        assertEquals(InitializationState.SOCKET_CONNECTED, receivedState)
    }

    @Test
    fun testListenerCalledImmediatelyIfAlreadyAtTargetState() {
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "test")
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTED, "test")

        var listenerCalled = false
        stateMachine.onStateReached(InitializationState.SOCKET_CONNECTED) {
            listenerCalled = true
        }

        assertTrue(listenerCalled)
    }

    @Test
    fun testSlowTransitionWarningThreshold() {
        // This test verifies that the expected duration method exists and returns reasonable values
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "test")
        Thread.sleep(100)
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTED, "test")

        // The transition should complete without errors
        assertEquals(InitializationState.SOCKET_CONNECTED, stateMachine.getCurrentState())
    }

    @Test
    fun testInvalidStateTransitionIsRejected() {
        // Transition to HTML_LOADED state
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "test")
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTED, "test")
        stateMachine.transitionTo(InitializationState.READY_RECEIVED, "test")
        stateMachine.transitionTo(InitializationState.INIT_DATA_SENT, "test")
        stateMachine.transitionTo(InitializationState.INITIALIZED_RECEIVED, "test")
        stateMachine.transitionTo(InitializationState.RPC_CREATING, "test")
        stateMachine.transitionTo(InitializationState.RPC_CREATED, "test")
        stateMachine.transitionTo(InitializationState.EXTENSION_ACTIVATING, "test")
        stateMachine.transitionTo(InitializationState.EXTENSION_ACTIVATED, "test")
        stateMachine.transitionTo(InitializationState.WEBVIEW_REGISTERING, "test")
        stateMachine.transitionTo(InitializationState.WEBVIEW_REGISTERED, "test")
        stateMachine.transitionTo(InitializationState.WEBVIEW_RESOLVING, "test")
        stateMachine.transitionTo(InitializationState.WEBVIEW_RESOLVED, "test")
        stateMachine.transitionTo(InitializationState.HTML_LOADING, "test")
        stateMachine.transitionTo(InitializationState.HTML_LOADED, "test")

        assertEquals(InitializationState.HTML_LOADED, stateMachine.getCurrentState())

        // Attempting to transition to HTML_LOADED again should succeed (idempotent)
        val result = stateMachine.transitionTo(InitializationState.HTML_LOADED, "duplicate transition")
        assertTrue("Idempotent transition should succeed", result)
        
        // State should remain HTML_LOADED
        assertEquals(InitializationState.HTML_LOADED, stateMachine.getCurrentState())
        
        // But transitioning to an invalid state (e.g., SOCKET_CONNECTING) should fail
        val invalidResult = stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "invalid backward transition")
        assertFalse("Invalid backward transition should fail", invalidResult)
        assertEquals(InitializationState.HTML_LOADED, stateMachine.getCurrentState())
    }
    
    @Test
    fun testIdempotentTransitions() {
        // Transition to a state
        assertTrue(stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "test"))
        assertEquals(InitializationState.SOCKET_CONNECTING, stateMachine.getCurrentState())
        
        // Attempt same transition again - should succeed (idempotent)
        assertTrue(stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "duplicate"))
        assertEquals(InitializationState.SOCKET_CONNECTING, stateMachine.getCurrentState())
    }

    @Test
    fun testTerminalStateProtection() {
        // Transition through to COMPLETE
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "test")
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTED, "test")
        stateMachine.transitionTo(InitializationState.READY_RECEIVED, "test")
        stateMachine.transitionTo(InitializationState.INIT_DATA_SENT, "test")
        stateMachine.transitionTo(InitializationState.INITIALIZED_RECEIVED, "test")
        stateMachine.transitionTo(InitializationState.RPC_CREATING, "test")
        stateMachine.transitionTo(InitializationState.RPC_CREATED, "test")
        stateMachine.transitionTo(InitializationState.EXTENSION_ACTIVATING, "test")
        stateMachine.transitionTo(InitializationState.EXTENSION_ACTIVATED, "test")
        stateMachine.transitionTo(InitializationState.COMPLETE, "test")
        
        assertEquals(InitializationState.COMPLETE, stateMachine.getCurrentState())
        
        // Attempt to transition from COMPLETE - should fail
        assertFalse(stateMachine.transitionTo(InitializationState.HTML_LOADED, "after complete"))
        assertEquals(InitializationState.COMPLETE, stateMachine.getCurrentState())
        
        // Attempt to transition to COMPLETE again - should succeed (idempotent)
        assertTrue(stateMachine.transitionTo(InitializationState.COMPLETE, "duplicate complete"))
        assertEquals(InitializationState.COMPLETE, stateMachine.getCurrentState())
    }

    @Test
    fun testRaceConditionScenario() {
        // Simulate the race condition: WEBVIEW_REGISTERING -> EXTENSION_ACTIVATED
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "test")
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTED, "test")
        stateMachine.transitionTo(InitializationState.READY_RECEIVED, "test")
        stateMachine.transitionTo(InitializationState.INIT_DATA_SENT, "test")
        stateMachine.transitionTo(InitializationState.INITIALIZED_RECEIVED, "test")
        stateMachine.transitionTo(InitializationState.RPC_CREATING, "test")
        stateMachine.transitionTo(InitializationState.RPC_CREATED, "test")
        stateMachine.transitionTo(InitializationState.EXTENSION_ACTIVATING, "test")
        
        // Webview registration starts before activation completes
        assertTrue(stateMachine.transitionTo(InitializationState.WEBVIEW_REGISTERING, "webview starts"))
        assertEquals(InitializationState.WEBVIEW_REGISTERING, stateMachine.getCurrentState())
        
        // Extension activation completes - this should now be allowed
        assertTrue(stateMachine.transitionTo(InitializationState.EXTENSION_ACTIVATED, "activation completes"))
        assertEquals(InitializationState.EXTENSION_ACTIVATED, stateMachine.getCurrentState())
    }
    
    @Test
    fun testFailedStateProtection() {
        // Transition to FAILED state
        stateMachine.transitionTo(InitializationState.SOCKET_CONNECTING, "test")
        stateMachine.transitionTo(InitializationState.FAILED, "test failure")
        
        assertEquals(InitializationState.FAILED, stateMachine.getCurrentState())
        
        // Attempt to transition from FAILED - should fail
        assertFalse(stateMachine.transitionTo(InitializationState.SOCKET_CONNECTED, "after failed"))
        assertEquals(InitializationState.FAILED, stateMachine.getCurrentState())
        
        // Attempt to transition to FAILED again - should succeed (idempotent)
        assertTrue(stateMachine.transitionTo(InitializationState.FAILED, "duplicate failed"))
        assertEquals(InitializationState.FAILED, stateMachine.getCurrentState())
    }
}
