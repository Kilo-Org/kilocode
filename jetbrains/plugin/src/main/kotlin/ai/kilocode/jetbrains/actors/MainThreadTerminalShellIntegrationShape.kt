// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import ai.kilocode.jetbrains.terminal.TerminalInstanceManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project

interface MainThreadTerminalShellIntegrationShape : Disposable {
    fun executeCommand(terminalId: Int, commandLine: String)
}

class MainThreadTerminalShellIntegration(
    private val project: Project,
) : MainThreadTerminalShellIntegrationShape {
    private val logger = Logger.getInstance(MainThreadTerminalShellIntegration::class.java)

    private val terminalManager = project.service<TerminalInstanceManager>()

    override fun executeCommand(terminalId: Int, commandLine: String) {
        logger.info("🚀 Executing Shell Integration command: terminalId=$terminalId, commandLine='$commandLine'")

        try {
            // Get terminal instance by numeric ID
            val terminalInstance = terminalManager.getTerminalInstance(terminalId)

            if (terminalInstance == null) {
                logger.warn("❌ Terminal instance not found: terminalId=$terminalId")
                return
            }

            logger.info("✅ Found terminal instance: ${terminalInstance.extHostTerminalId}")

            // Execute command in terminal
            terminalInstance.sendText(commandLine, shouldExecute = true)

            logger.info("✅ Command sent to terminal: terminalId=$terminalId, command='$commandLine'")
        } catch (e: Exception) {
            logger.error("❌ Failed to execute Shell Integration command: terminalId=$terminalId, command='$commandLine'", e)
        }
    }

    override fun dispose() {
        logger.info("🧹 Destroying MainThreadTerminalShellIntegration")
    }
}
