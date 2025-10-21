// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger

/**
 * Main thread task service interface.
 * Corresponds to the MainThreadTaskShape interface in VSCode.
 */
interface MainThreadTaskShape : Disposable {
    /**
     * Creates task ID.
     * @param task Task DTO
     * @return Task ID
     */
    fun createTaskId(task: Map<String, Any?>): String

    /**
     * Registers task provider.
     * @param handle Provider ID
     * @param type Task type
     */
    fun registerTaskProvider(handle: Int, type: String)

    /**
     * Unregisters task provider.
     * @param handle Provider ID
     */
    fun unregisterTaskProvider(handle: Int)

    /**
     * Fetches task list.
     * @param filter Task filter
     * @return Task list
     */
    fun fetchTasks(filter: Map<String, Any?>?): List<Map<String, Any?>>

    /**
     * Gets task execution instance.
     * @param value Task handle or task DTO
     * @return Task execution DTO
     */
    fun getTaskExecution(value: Map<String, Any?>): Map<String, Any?>

    /**
     * Executes task.
     * @param task Task handle or task DTO
     * @return Task execution DTO
     */
    fun executeTask(task: Map<String, Any?>): Map<String, Any?>

    /**
     * Terminates task.
     * @param id Task ID
     */
    fun terminateTask(id: String)

    /**
     * Registers task system.
     * @param scheme Scheme
     * @param info Task system information
     */
    fun registerTaskSystem(scheme: String, info: Map<String, Any?>)

    /**
     * Custom execution complete.
     * @param id Task ID
     * @param result Execution result
     */
    fun customExecutionComplete(id: String, result: Int?)

    /**
     * Registers supported execution types.
     * @param custom Whether supports custom execution
     * @param shell Whether supports shell execution
     * @param process Whether supports process execution
     */
    fun registerSupportedExecutions(custom: Boolean?, shell: Boolean?, process: Boolean?)
}

/**
 * Implementation of the main thread task service.
 * Provides task-related functionality for the IDEA platform.
 */
class MainThreadTask : MainThreadTaskShape {
    private val logger = Logger.getInstance(MainThreadTask::class.java)
    private val taskProviders = mutableMapOf<Int, String>()
    private val taskExecutions = mutableMapOf<String, Map<String, Any?>>()

    override fun createTaskId(task: Map<String, Any?>): String {
        try {
            logger.info("Creating task ID for task: $task")
            val id = "task-${System.currentTimeMillis()}-${task.hashCode()}"
            logger.debug("Generated task ID: $id")
            return id
        } catch (e: Exception) {
            logger.error("Failed to create task ID", e)
            throw e
        }
    }

    override fun registerTaskProvider(handle: Int, type: String) {
        try {
            logger.info("Registering task provider: handle=$handle, type=$type")
            taskProviders[handle] = type
        } catch (e: Exception) {
            logger.error("Failed to register task provider", e)
        }
    }

    override fun unregisterTaskProvider(handle: Int) {
        try {
            logger.info("Unregistering task provider: handle=$handle")
            taskProviders.remove(handle)
        } catch (e: Exception) {
            logger.error("Failed to unregister task provider", e)
        }
    }

    override fun fetchTasks(filter: Map<String, Any?>?): List<Map<String, Any?>> {
        try {
            logger.info("Fetching tasks with filter: $filter")
            // TODO: Actual implementation should query IDEA's task system
            return emptyList()
        } catch (e: Exception) {
            logger.error("Failed to get tasks", e)
            throw e
        }
    }

    override fun getTaskExecution(value: Map<String, Any?>): Map<String, Any?> {
        try {
            val taskId = value["id"] as? String ?: value["taskId"] as? String
            logger.info("Getting task execution for task: $taskId")

            // Create a simple task execution DTO
            return mapOf(
                "id" to (taskId ?: "unknown-task"),
                "task" to value,
                "active" to false,
            )
        } catch (e: Exception) {
            logger.error("Failed to get task execution", e)
            throw e
        }
    }

    override fun executeTask(task: Map<String, Any?>): Map<String, Any?> {
        try {
            val taskId = task["id"] as? String ?: task["taskId"] as? String ?: "unknown-task"
            logger.info("Executing task: $taskId")

            // Create an executing task execution DTO
            val execution = mapOf(
                "id" to taskId,
                "task" to task,
                "active" to true,
            )

            // Store task execution information
            taskExecutions[taskId] = execution
            return execution
        } catch (e: Exception) {
            logger.error("Failed to execute task", e)
            throw e
        }
    }

    override fun terminateTask(id: String) {
        try {
            logger.info("Terminating task: $id")
            taskExecutions.remove(id)
        } catch (e: Exception) {
            logger.error("Failed to terminate task", e)
        }
    }

    override fun registerTaskSystem(scheme: String, info: Map<String, Any?>) {
        try {
            logger.info("Registering task system: scheme=$scheme, info=$info")
            // Register task system
        } catch (e: Exception) {
            logger.error("Failed to register task system", e)
        }
    }

    override fun customExecutionComplete(id: String, result: Int?) {
        try {
            logger.info("Custom execution complete for task: $id with result: $result")
            // Update task execution status
            taskExecutions[id]?.let { execution ->
                taskExecutions[id] = execution + ("active" to false)
            }
        } catch (e: Exception) {
            logger.error("Failed to update custom execution completion status", e)
        }
    }

    override fun registerSupportedExecutions(custom: Boolean?, shell: Boolean?, process: Boolean?) {
        try {
            logger.info("Registering supported executions: custom=$custom, shell=$shell, process=$process")
        } catch (e: Exception) {
            logger.error("Failed to register supported execution types", e)
        }
    }

    override fun dispose() {
        logger.info("Disposing MainThreadTask")
        taskProviders.clear()
        taskExecutions.clear()
    }
}
