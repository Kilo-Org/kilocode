// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.core

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import java.io.IOException
import java.net.StandardProtocolFamily
import java.net.UnixDomainSocketAddress
import java.nio.channels.ServerSocketChannel
import java.nio.channels.SocketChannel
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

    // ExtensionUnixDomainSocketServer is responsible for communication between extension process and IDEA plugin process via Unix Domain Socket
class ExtensionUnixDomainSocketServer : ISocketServer {
    // Logger
    private val logger = Logger.getInstance(ExtensionUnixDomainSocketServer::class.java)
    // UDS server channel
    private var udsServerChannel: ServerSocketChannel? = null
    // UDS socket file path
    private var udsSocketPath: Path? = null
    // Mapping of client connections and managers
    private val clientManagers = ConcurrentHashMap<SocketChannel, ExtensionHostManager>()
    // Server listening thread
    private var serverThread: Thread? = null
    // Current project path
    private var projectPath: String = ""

    lateinit var project: Project

    @Volatile private var isRunning = false // Server running state

    // Start UDS server, return socket file path
    override fun start(projectPath: String): String? {
        if (isRunning) {
            logger.info("UDS server is already running")
            return udsSocketPath?.toString()
        }
        this.projectPath = projectPath
        return startUds()
    }

    // Actual logic to start UDS server
    private fun startUds(): String? {
        try {
            val sockPath = createSocketFile() // Create socket file
            val udsAddr = UnixDomainSocketAddress.of(sockPath)
            udsServerChannel = ServerSocketChannel.open(StandardProtocolFamily.UNIX)
            udsServerChannel!!.bind(udsAddr)
            udsSocketPath = sockPath
            isRunning = true
            logger.info("[UDS] Listening on: $sockPath")
            // Start listening thread, asynchronously accept client connections
            serverThread =
                    thread(start = true, name = "ExtensionUDSSocketServer") {
                        acceptUdsConnections()
                    }
            return sockPath.toString()
        } catch (e: Exception) {
            logger.error("[UDS] Failed to start server", e)
            stop()
            return null
        }
    }

    // Stop UDS server, release resources
    override fun stop() {
        if (!isRunning) return
        isRunning = false
        logger.info("Stopping UDS socket server")
        // Close all client connections
        clientManagers.forEach { (_, manager) ->
            try {
                manager.dispose()
            } catch (e: Exception) {
                logger.warn("Failed to dispose client manager", e)
            }
        }
        clientManagers.clear()
        try {
            udsServerChannel?.close()
        } catch (e: Exception) {
            logger.warn("Failed to close UDS server channel", e)
        }
        try {
            udsSocketPath?.let { Files.deleteIfExists(it) }
        } catch (e: Exception) {
            logger.warn("Failed to delete UDS socket file", e)
        }
        // Thread and channel cleanup
        serverThread?.interrupt()
        serverThread = null
        udsServerChannel = null
        udsSocketPath = null
        logger.info("UDS socket server stopped")
    }

    override fun isRunning(): Boolean = isRunning
    override fun dispose() {
        stop()
    }

    // Listen and accept UDS client connections
    private fun acceptUdsConnections() {
        val server = udsServerChannel ?: return
        logger.info("[UDS] Waiting for connections..., tid: ${Thread.currentThread().id}")
        while (isRunning && !Thread.currentThread().isInterrupted) {
            try {
                val clientChannel = server.accept() // Block and wait for new connection
                logger.info("[UDS] New client connected")
                val manager = ExtensionHostManager(clientChannel, projectPath,project)
                clientManagers[clientChannel] = manager
                handleClient(clientChannel, manager) // Start client handler thread
            } catch (e: Exception) {
                if (isRunning) {
                    logger.error("[UDS] Accept failed, will retry in 1s", e)
                    Thread.sleep(1000)
                } else {
                    logger.info("[UDS] Accept loop exiting (server stopped)")
                    break
                }
            }
        }
        logger.info("[UDS] Accept loop terminated.")
    }

    // Handle single client connection, responsible for heartbeat check and resource release
    private fun handleClient(clientChannel: SocketChannel, manager: ExtensionHostManager) {
        try {
            manager.start() // Start extension host manager

            var lastCheckTime = System.currentTimeMillis()
            val CHECK_INTERVAL = 15000 // Heartbeat check interval

            while (clientChannel.isConnected && clientChannel.isOpen && isRunning) {
                try {
                    val currentTime = System.currentTimeMillis()
                    if (currentTime - lastCheckTime > CHECK_INTERVAL) {
                        lastCheckTime = currentTime

                        // UDS has no input/output shutdown flag, can only use isOpen
                        if (!clientChannel.isOpen) {
                            logger.error("[UDS] Client channel unhealthy, closing.")
                            break
                        }

                        val responsiveState = manager.getResponsiveState()
                        if (responsiveState != null) {
                            logger.debug("[UDS] Client RPC state: $responsiveState")
                        }
                    }

                    Thread.sleep(500)
                } catch (ie: InterruptedException) {
                    logger.info("[UDS] Client handler interrupted, exiting loop")
                    break
                }
            }
        } catch (e: Exception) {
            if (e !is InterruptedException) {
                logger.error("[UDS] Error in client handler: ${e.message}", e)
            } else {
                logger.info("[UDS] Client handler interrupted during processing")
            }
        } finally {
            // Connection close and resource release
            manager.dispose()
            clientManagers.remove(clientChannel)
            try {
                clientChannel.close()
            } catch (e: IOException) {
                logger.warn("[UDS] Close client channel error", e)
            }
            logger.info("[UDS] Client channel closed and removed.")
        }
    }

    // Create temporary socket file, ensure uniqueness
    private fun createSocketFile(): Path {
        val tmpDir = java.nio.file.Paths.get("/tmp")
        val sockPath = Files.createTempFile(tmpDir, "roo-cline-idea-extension-ipc-", ".sock")
        Files.deleteIfExists(sockPath) // Ensure it does not exist
        return sockPath
    }
}
