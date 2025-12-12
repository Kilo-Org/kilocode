// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import ai.kilocode.jetbrains.commands.CommandRegistry
import ai.kilocode.jetbrains.commands.ICommand
import ai.kilocode.jetbrains.commands.registerSetContextCommands
import ai.kilocode.jetbrains.editor.registerOpenEditorAPICommands
import ai.kilocode.jetbrains.terminal.registerTerminalAPICommands
import ai.kilocode.jetbrains.util.doInvokeMethod
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import kotlin.reflect.full.functions

/**
 * Main thread commands interface.
 * Corresponds to the MainThreadCommandsShape interface in VSCode.
 */
interface MainThreadCommandsShape : Disposable {
    /**
     * Registers a command.
     * @param id The command identifier
     */
    fun registerCommand(id: String)

    /**
     * Unregisters a command.
     * @param id The command identifier
     */
    fun unregisterCommand(id: String)

    /**
     * Fires a command activation event.
     * @param id The command identifier
     */
    fun fireCommandActivationEvent(id: String)

    /**
     * Executes a command.
     * @param id The command identifier
     * @param args List of arguments for the command
     * @return The execution result
     */
    suspend fun executeCommand(id: String, args: List<Any?>): Any?

    /**
     * Gets all registered commands.
     * @return List of command identifiers
     */
    fun getCommands(): List<String>
}

/**
 * Implementation of MainThreadCommandsShape that handles command registration and execution.
 * Manages a registry of commands and provides methods to interact with them.
 *
 * @property project The current project context
 */
class MainThreadCommands(val project: Project) : MainThreadCommandsShape {
    private val registry = CommandRegistry(project)
    private val logger = Logger.getInstance(MainThreadCommandsShape::class.java)

    /**
     * Initializes the command registry with default commands.
     */
    init {
        registerOpenEditorAPICommands(project, registry)
        registerTerminalAPICommands(project, registry)
        registerSetContextCommands(project, registry)
        // TODO other commands
    }

    /**
     * Registers a command with the given identifier.
     *
     * @param id The command identifier
     */
    override fun registerCommand(id: String) {
        logger.info("Registering command: $id")
    }

    /**
     * Unregisters a command with the given identifier.
     *
     * @param id The command identifier
     */
    override fun unregisterCommand(id: String) {
        logger.info("Unregistering command: $id")
    }

    /**
     * Fires an activation event for the specified command.
     *
     * @param id The command identifier
     */
    override fun fireCommandActivationEvent(id: String) {
        logger.info("Firing command activation event: $id")
    }

    /**
     * Executes a command with the given identifier and arguments.
     *
     * @param id The command identifier
     * @param args List of arguments for the command
     * @return The execution result
     */
    override suspend fun executeCommand(id: String, args: List<Any?>): Any? {
        logger.info("Executing command: $id ")
        registry.getCommand(id)?.let { cmd ->
            runCmd(cmd, args)
        } ?: run {
            logger.warn("Command not found: $id")
        }
        return Unit
    }

    /**
     * Gets all registered command identifiers.
     *
     * @return List of command identifiers
     */
    override fun getCommands(): List<String> {
        logger.info("Getting all commands")
        return registry.getCommands().keys.toList()
    }

    /**
     * Releases resources used by this command handler.
     */
    override fun dispose() {
        logger.info("Releasing resources: MainThreadCommands")
    }

    /**
     * Runs a command with the given arguments.
     * Finds the appropriate method on the command handler and invokes it.
     *
     * @param cmd The command to run
     * @param args List of arguments for the command
     */
    private suspend fun runCmd(cmd: ICommand, args: List<Any?>) {
        val handler = cmd.handler()
        val method = try {
//            handler.javaClass.methods.first { it.name == cmd.getMethod()}
            handler::class.functions.first { it.name == cmd.getMethod() }
        } catch (e: Exception) {
            logger.error("Command method not found: ${cmd.getMethod()}")
            return
        }
        doInvokeMethod(method, args, handler)
    }
}
