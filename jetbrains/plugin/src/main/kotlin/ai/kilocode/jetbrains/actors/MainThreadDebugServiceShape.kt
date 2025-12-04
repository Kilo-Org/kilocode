// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import java.net.URI

/**
 * Main thread debug service interface.
 * This interface defines the contract for debug services that operate on the main thread,
 * providing methods for managing debug sessions, breakpoints, and debug adapter communication.
 */
interface MainThreadDebugServiceShape : Disposable {
    /**
     * Registers debug types that this service can handle.
     * @param debugTypes List of debug type identifiers (e.g., "java", "python", "node")
     */
    fun registerDebugTypes(debugTypes: List<String>)

    /**
     * Notifies that a debug session has been cached/stored for later use.
     * @param sessionID Unique identifier for the debug session
     */
    fun sessionCached(sessionID: String)

    /**
     * Accepts and processes a message from the debug adapter.
     * @param handle Unique handle identifying the debug adapter connection
     * @param message The protocol message received from the debug adapter
     */
    fun acceptDAMessage(handle: Int, message: Any)

    /**
     * Accepts and processes an error reported by the debug adapter.
     * @param handle Unique handle identifying the debug adapter connection
     * @param name The error name/type
     * @param message Human-readable error message
     * @param stack Optional stack trace for the error
     */
    fun acceptDAError(handle: Int, name: String, message: String, stack: String?)

    /**
     * Accepts notification that the debug adapter has exited.
     * @param handle Unique handle identifying the debug adapter connection
     * @param code Optional exit code (null if terminated by signal)
     * @param signal Optional signal name that caused termination (null if exited normally)
     */
    fun acceptDAExit(handle: Int, code: Int?, signal: String?)

    /**
     * Registers a debug configuration provider for a specific debug type.
     * @param type The debug type this provider handles
     * @param triggerKind When this provider should be triggered (1=initial, 2=dynamic)
     * @param hasProvideMethod Whether this provider has a provideDebugConfigurations method
     * @param hasResolveMethod Whether this provider has a resolveDebugConfiguration method
     * @param hasResolve2Method Whether this provider has a resolveDebugConfigurationWithSubstitutedVariables method
     * @param handle Unique handle for this provider registration
     * @return Registration result (typically Unit or success indicator)
     */
    fun registerDebugConfigurationProvider(
        type: String,
        triggerKind: Int,
        hasProvideMethod: Boolean,
        hasResolveMethod: Boolean,
        hasResolve2Method: Boolean,
        handle: Int,
    ): Any

    /**
     * Registers a debug adapter descriptor factory for a specific debug type.
     * @param type The debug type this factory creates adapters for
     * @param handle Unique handle for this factory registration
     * @return Registration result (typically Unit or success indicator)
     */
    fun registerDebugAdapterDescriptorFactory(type: String, handle: Int): Any

    /**
     * Unregisters a debug configuration provider.
     * @param handle The handle of the provider to unregister
     */
    fun unregisterDebugConfigurationProvider(handle: Int)

    /**
     * Unregisters a debug adapter descriptor factory.
     * @param handle The handle of the factory to unregister
     */
    fun unregisterDebugAdapterDescriptorFactory(handle: Int)

    /**
     * Starts a new debugging session.
     * @param folder Optional workspace folder URI for the debug session
     * @param nameOrConfig Either the name of a predefined configuration or the configuration object itself
     * @param options Launch options for the debug session
     * @return Success indicator (true if debugging started successfully)
     */
    fun startDebugging(folder: URI?, nameOrConfig: Any, options: Any): Any

    /**
     * Stops an active debugging session.
     * @param sessionId Optional session ID to stop (null stops all sessions)
     * @return Operation result (typically Unit)
     */
    fun stopDebugging(sessionId: String?): Any

    /**
     * Sets a custom name for a debug session.
     * @param id The session ID to name
     * @param name The display name for the session
     */
    fun setDebugSessionName(id: String, name: String)

    /**
     * Sends a custom request to the debug adapter.
     * @param id The session ID to send the request to
     * @param command The debug adapter protocol command
     * @param args Arguments for the command
     * @return The response from the debug adapter
     */
    fun customDebugAdapterRequest(id: String, command: String, args: Any): Any

    /**
     * Retrieves information about a specific breakpoint from the debug protocol.
     * @param id The session ID
     * @param breakpoinId The breakpoint ID to query
     * @return Breakpoint information or null if not found
     */
    fun getDebugProtocolBreakpoint(id: String, breakpoinId: String): Any?

    /**
     * Appends text to the debug console output.
     * @param value The text to append to the console
     */
    fun appendDebugConsole(value: String)

    /**
     * Registers new breakpoints with the debug service.
     * @param breakpoints List of breakpoint objects to register
     * @return Registration result (typically Unit or success indicator)
     */
    fun registerBreakpoints(breakpoints: List<Any>): Any

    /**
     * Unregisters existing breakpoints.
     * @param breakpointIds List of regular breakpoint IDs to remove
     * @param functionBreakpointIds List of function breakpoint IDs to remove
     * @param dataBreakpointIds List of data breakpoint IDs to remove
     * @return Unregistration result (typically Unit)
     */
    fun unregisterBreakpoints(
        breakpointIds: List<String>,
        functionBreakpointIds: List<String>,
        dataBreakpointIds: List<String>,
    ): Any

    /**
     * Registers a debug visualizer extension.
     * @param extensionId The ID of the extension providing the visualizer
     * @param id The unique ID of the visualizer within the extension
     */
    fun registerDebugVisualizer(extensionId: String, id: String)

    /**
     * Unregisters a debug visualizer extension.
     * @param extensionId The ID of the extension providing the visualizer
     * @param id The unique ID of the visualizer within the extension
     */
    fun unregisterDebugVisualizer(extensionId: String, id: String)

    /**
     * Registers a debug visualizer tree structure.
     * @param treeId Unique identifier for the tree
     * @param canEdit Whether the tree structure can be edited by users
     */
    fun registerDebugVisualizerTree(treeId: String, canEdit: Boolean)

    /**
     * Unregisters a debug visualizer tree structure.
     * @param treeId Unique identifier for the tree to unregister
     */
    fun unregisterDebugVisualizerTree(treeId: String)
}

/**
 * Main thread debug service implementation.
 * This class provides the concrete implementation of the MainThreadDebugServiceShape interface,
 * handling debug session management, breakpoint operations, and debug adapter communication.
 * All operations are logged for debugging purposes.
 */
class MainThreadDebugService : MainThreadDebugServiceShape {
    private val logger = Logger.getInstance(MainThreadDebugService::class.java)

    override fun registerDebugTypes(debugTypes: List<String>) {
        logger.info("Registering debug types: $debugTypes")
    }

    override fun sessionCached(sessionID: String) {
        logger.info("Session cached: $sessionID")
    }

    override fun acceptDAMessage(handle: Int, message: Any) {
        logger.info("Received debug adapter message: handle=$handle, message=$message")
    }

    override fun acceptDAError(handle: Int, name: String, message: String, stack: String?) {
        logger.info("Received debug adapter error: handle=$handle, name=$name, message=$message, stack=$stack")
    }

    override fun acceptDAExit(handle: Int, code: Int?, signal: String?) {
        logger.info("Received debug adapter exit: handle=$handle, code=$code, signal=$signal")
    }

    override fun registerDebugConfigurationProvider(
        type: String,
        triggerKind: Int,
        hasProvideMethod: Boolean,
        hasResolveMethod: Boolean,
        hasResolve2Method: Boolean,
        handle: Int,
    ): Any {
        logger.info(
            "Registering debug configuration provider: type=$type, triggerKind=$triggerKind, " +
                "hasProvideMethod=$hasProvideMethod, hasResolveMethod=$hasResolveMethod, " +
                "hasResolve2Method=$hasResolve2Method, handle=$handle",
        )
        return Unit
    }

    override fun registerDebugAdapterDescriptorFactory(type: String, handle: Int): Any {
        logger.info("Registering debug adapter descriptor factory: type=$type, handle=$handle")
        return Unit
    }

    override fun unregisterDebugConfigurationProvider(handle: Int) {
        logger.info("Unregistering debug configuration provider: handle=$handle")
    }

    override fun unregisterDebugAdapterDescriptorFactory(handle: Int) {
        logger.info("Unregistering debug adapter descriptor factory: handle=$handle")
    }

    override fun startDebugging(folder: URI?, nameOrConfig: Any, options: Any): Any {
        logger.info("Starting debugging: folder=$folder, nameOrConfig=$nameOrConfig, options=$options")
        return true
    }

    override fun stopDebugging(sessionId: String?): Any {
        logger.info("Stopping debugging: sessionId=$sessionId")
        return Unit
    }

    override fun setDebugSessionName(id: String, name: String) {
        logger.info("Setting debug session name: id=$id, name=$name")
    }

    override fun customDebugAdapterRequest(id: String, command: String, args: Any): Any {
        logger.info("Custom debug adapter request: id=$id, command=$command, args=$args")
        return Unit
    }

    override fun getDebugProtocolBreakpoint(id: String, breakpoinId: String): Any? {
        logger.info("Getting debug protocol breakpoint: id=$id, breakpoinId=$breakpoinId")
        return Unit
    }

    override fun appendDebugConsole(value: String) {
        logger.info("Appending to debug console: $value")
    }

    override fun registerBreakpoints(breakpoints: List<Any>): Any {
        logger.info("Registering breakpoints: ${breakpoints.size} total")
        return Unit
    }

    override fun unregisterBreakpoints(
        breakpointIds: List<String>,
        functionBreakpointIds: List<String>,
        dataBreakpointIds: List<String>,
    ): Any {
        logger.info(
            "Unregistering breakpoints: ${breakpointIds.size} regular, " +
                "${functionBreakpointIds.size} function, " +
                "${dataBreakpointIds.size} data breakpoints",
        )
        return Unit
    }

    override fun registerDebugVisualizer(extensionId: String, id: String) {
        logger.info("Registering debug visualizer: extensionId=$extensionId, id=$id")
    }

    override fun unregisterDebugVisualizer(extensionId: String, id: String) {
        logger.info("Unregistering debug visualizer: extensionId=$extensionId, id=$id")
    }

    override fun registerDebugVisualizerTree(treeId: String, canEdit: Boolean) {
        logger.info("Registering debug visualizer tree: treeId=$treeId, canEdit=$canEdit")
    }

    override fun unregisterDebugVisualizerTree(treeId: String) {
        logger.info("Unregistering debug visualizer tree: treeId=$treeId")
    }

    override fun dispose() {
        logger.info("Disposing MainThreadDebugService")
    }
}
