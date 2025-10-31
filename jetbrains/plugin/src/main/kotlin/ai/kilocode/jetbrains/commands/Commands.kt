// Copyright 2009-2025 Weibo, Inc.
// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.commands

import com.intellij.openapi.project.Project
/**
 * Interface representing a command in the system.
 * Commands are used to define executable actions that can be registered and invoked.
 */
interface ICommand {
    /**
     * Gets the unique identifier for this command.
     * @return The command ID as a string
     */
    fun getId(): String

    /**
     * Gets the method name that should be invoked when this command is executed.
     * @return The method name as a string
     */
    fun getMethod(): String

    /**
     * Gets the handler object that contains the method to be invoked.
     * @return The handler object
     */
    fun handler(): Any

    /**
     * Gets the return type of the command, if any.
     * @return The return type as a string, or null if the command doesn't return a value
     */
    fun returns(): String?
}

/**
 * Interface for a registry that manages commands.
 * Provides functionality to register, retrieve, and manage commands in the system.
 */
interface ICommandRegistry {
    /**
     * Called when a command is registered.
     * @param id The ID of the registered command
     */
    fun onDidRegisterCommand(id: String)

    /**
     * Registers a command in the registry.
     * @param command The command to register
     */
    fun registerCommand(command: ICommand)

    /**
     * Registers an alias for an existing command.
     * @param oldId The ID of the existing command
     * @param newId The new alias ID for the command
     */
    fun registerCommandAlias(oldId: String, newId: String)

    /**
     * Gets a command by its ID.
     * @param id The ID of the command to retrieve
     * @return The command, or null if not found
     */
    fun getCommand(id: String): ICommand?

    /**
     * Gets all registered commands.
     * @return A map of command IDs to commands
     */
    fun getCommands(): Map<String, ICommand>
}

/**
 * Implementation of the ICommandRegistry interface.
 * Manages commands for a specific project.
 *
 * @property project The project context for this command registry
 */
class CommandRegistry(val project: Project) : ICommandRegistry {

    /**
     * Map of command IDs to lists of commands.
     * Using a list allows for potential command overloading in the future.
     */
    private val commands = mutableMapOf<String, MutableList<ICommand>>()

    /**
     * Called when a command is registered.
     * Currently not implemented.
     *
     * @param id The ID of the registered command
     */
    override fun onDidRegisterCommand(id: String) {
        TODO("Not yet implemented")
    }

    /**
     * Registers a command in the registry.
     *
     * @param command The command to register
     */
    override fun registerCommand(command: ICommand) {
        commands.put(command.getId(), mutableListOf(command))
    }

    /**
     * Registers an alias for an existing command.
     * If the original command exists, creates a new entry with the new ID pointing to the same command.
     *
     * @param oldId The ID of the existing command
     * @param newId The new alias ID for the command
     */
    override fun registerCommandAlias(oldId: String, newId: String) {
        getCommand(oldId)?.let {
            commands.put(newId, mutableListOf(it))
        }
    }

    /**
     * Gets a command by its ID.
     * Returns the first command registered with the given ID, or null if not found.
     *
     * @param id The ID of the command to retrieve
     * @return The command, or null if not found
     */
    override fun getCommand(id: String): ICommand? {
        return commands[id]?.firstOrNull()
    }

    /**
     * Gets all registered commands.
     * Returns a map of command IDs to the first command registered with each ID.
     *
     * @return A map of command IDs to commands
     */
    override fun getCommands(): Map<String, ICommand> {
        return commands.mapValues { it.value.first() }
    }
}
