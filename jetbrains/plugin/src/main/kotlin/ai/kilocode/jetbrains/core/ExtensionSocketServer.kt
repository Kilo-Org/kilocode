package ai.kilocode.jetbrains.core

import ai.kilocode.jetbrains.monitoring.DisposableTracker
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import java.io.IOException
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

/**
 * Extension process Socket server
 * Used to establish communication with extension process
 */
interface ISocketServer : Disposable {
    fun start(projectPath: String = ""): Any?
    fun stop()
    fun isRunning(): Boolean
}

class ExtensionSocketServer() : ISocketServer {
    private val logger = Logger.getInstance(ExtensionSocketServer::class.java)

    // Server socket
    private var serverSocket: ServerSocket? = null

    // Connected client managers
    private val clientManagers = ConcurrentHashMap<Socket, ExtensionHostManager>()

    // Server thread
    private var serverThread: Thread? = null
    
    private val clientThreads = ConcurrentHashMap<Socket, Thread>()
    
    // Current project path
    private var projectPath: String = ""

    // Whether running
    @Volatile
    private var isRunning = false

    lateinit var project: Project

    /**
     * Start Socket server
     * @param projectPath Current project path
     * @return Server port, -1 if failed
     */
    override fun start(projectPath: String): Int {
        if (isRunning) {
            logger.info("Socket server is already running")
            return serverSocket?.localPort ?: -1
        }

        this.projectPath = projectPath

        try {
            // Use 0 to indicate random port assignment
            serverSocket = ServerSocket(0)
            val port = serverSocket?.localPort ?: -1

            if (port <= 0) {
                logger.error("Failed to get valid port for socket server")
                return -1
            }

            isRunning = true
            logger.info("Starting socket server on port: $port")
            
            DisposableTracker.register("ExtensionSocketServer", this)

            // Start the thread to accept connections
            serverThread = thread(start = true, name = "ExtensionSocketServer") {
                acceptConnections()
            }

            return port
        } catch (e: Exception) {
            logger.error("Failed to start socket server", e)
            stop()
            return -1
        }
    }

    /**
     * Stop Socket server
     */
    override fun stop() {
        if (!isRunning) {
            return
        }

        logger.info("Stopping socket server")
        isRunning = false

        // First, interrupt the server thread to stop accepting new connections
        serverThread?.interrupt()

        // Wait for the server thread to finish
        try {
            serverThread?.join(5000) // Wait up to 5 seconds
        } catch (e: InterruptedException) {
            logger.warn("Interrupted while waiting for server thread to finish")
            Thread.currentThread().interrupt()
        }

        // Interrupt all client handler threads
        clientThreads.forEach { (socket, thread) ->
            try {
                thread.interrupt()
            } catch (e: Exception) {
                logger.warn("Failed to interrupt client handler thread", e)
            }
        }

        // Wait for client handler threads to finish
        clientThreads.forEach { (socket, thread) ->
            try {
                thread.join(2000) // Wait up to 2 seconds per thread
            } catch (e: InterruptedException) {
                logger.warn("Interrupted while waiting for client handler thread to finish")
                Thread.currentThread().interrupt()
            }
        }
        clientThreads.clear()

        // Close all client managers and wait for them to finish
        clientManagers.forEach { (socket, manager) ->
            try {
                manager.dispose()
            } catch (e: Exception) {
                logger.warn("Failed to dispose client manager", e)
            }
        }
        clientManagers.clear()

        // Wait a bit for all client connections to be properly closed
        try {
            Thread.sleep(1000)
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
        }

        // Close the server socket
        try {
            serverSocket?.close()
        } catch (e: IOException) {
            logger.warn("Failed to close server socket", e)
        }

        // Clean up references
        serverThread = null
        serverSocket = null

        DisposableTracker.unregister("ExtensionSocketServer")

        logger.info("Socket server stopped completely")
    }

    /**
     * Thread function for accepting connections
     */
    private fun acceptConnections() {
        val server = serverSocket ?: return

        logger.info("Socket server started, waiting for connections..., tid: ${Thread.currentThread().threadId()}")

        while (isRunning && !Thread.currentThread().isInterrupted) {
            try {
                val clientSocket = server.accept()
                logger.info("New client connected from: ${clientSocket.inetAddress.hostAddress}")

                clientSocket.tcpNoDelay = true // Set no delay

                // Create extension host manager
                val manager = ExtensionHostManager(clientSocket, projectPath, project)
                clientManagers[clientSocket] = manager
                
                // Register with PluginContext for access from UI
                project.getService(PluginContext::class.java).setExtensionHostManager(manager)

                handleClient(clientSocket, manager)
            } catch (e: IOException) {
                if (isRunning) {
                    logger.error("Error accepting client connection", e)
                } else {
                    // IOException is thrown when ServerSocket is closed, this is normal
                    logger.info("Socket server closed")
                    break
                }
            } catch (e: InterruptedException) {
                // Thread interrupted, this is normal
                logger.info("Socket server thread interrupted")
                break
            } catch (e: Exception) {
                logger.error("Unexpected error in accept loop", e)
                if (isRunning) {
                    try {
                        // Retry after short delay
                        Thread.sleep(1000)
                    } catch (ie: InterruptedException) {
                        // Thread interrupted, server is shutting down
                        logger.info("Socket server thread interrupted during sleep")
                        break
                    }
                }
            }
        }

        logger.info("Socket accept loop terminated")
    }

    /**
     * Handle client connection
     */
    private fun handleClient(clientSocket: Socket, manager: ExtensionHostManager) {
        try {
            // Start extension host manager
            manager.start()

            // Periodically check socket health
            var lastCheckTime = System.currentTimeMillis()
            val CHECK_INTERVAL = 15000 // Check every 15 seconds

            // Wait for socket to close
            while (clientSocket.isConnected && !clientSocket.isClosed && isRunning) {
                try {
                    // Periodically check connection health
                    val currentTime = System.currentTimeMillis()
                    if (currentTime - lastCheckTime > CHECK_INTERVAL) {
                        lastCheckTime = currentTime

                        if (!isSocketHealthy(clientSocket)) {
                            logger.error("Detected unhealthy Socket connection, closing connection")
                            break
                        }

                        // Check RPC response state
                        val responsiveState = manager.getResponsiveState()
                        if (responsiveState != null) {
                            logger.debug("Current RPC response state: $responsiveState")
                        }
                    }

                    Thread.sleep(500)
                } catch (ie: InterruptedException) {
                    // Thread interrupted, server is shutting down, exit loop
                    logger.info("Client handler thread interrupted, exiting loop")
                    break
                }
            }
        } catch (e: Exception) {
            // Filter out InterruptedException, it means normal interruption
            if (e !is InterruptedException) {
                logger.error("Error handling client socket: ${e.message}", e)
            } else {
                logger.info("Client handler thread interrupted during processing")
            }
        } finally {
            // Clean up resources
            manager.dispose()
            clientManagers.remove(clientSocket)

            if (!clientSocket.isClosed) {
                try {
                    clientSocket.close()
                } catch (e: IOException) {
                    logger.warn("Failed to close client socket", e)
                }
            }

            logger.info("Client socket closed and removed")
        }
    }

    /**
     * Check socket connection health
     */
    private fun isSocketHealthy(socket: Socket): Boolean {
        val isHealthy = socket.isConnected &&
            !socket.isClosed &&
            !socket.isInputShutdown &&
            !socket.isOutputShutdown

        if (!isHealthy) {
            logger.warn(
                "Socket health check failed: isConnected=${socket.isConnected}, " +
                    "isClosed=${socket.isClosed}, " +
                    "isInputShutdown=${socket.isInputShutdown}, " +
                    "isOutputShutdown=${socket.isOutputShutdown}",
            )
        }

        return isHealthy
    }

    /**
     * Get current port
     */
    fun getPort(): Int {
        return serverSocket?.localPort ?: -1
    }

    /**
     * Whether running
     */
    override fun isRunning(): Boolean {
        return isRunning
    }

    /**
     * Resource cleanup
     */
    override fun dispose() {
        stop()
    }

    /**
     * Connect to debug host
     * @param host Debug host address
     * @param port Debug host port
     * @return Whether connection is successful
     */
    fun connectToDebugHost(host: String, port: Int): Boolean {
        if (isRunning) {
            logger.info("Socket server is already running, stopping first")
            stop()
        }

        try {
            logger.info("Connecting to debug host at $host:$port")

            // Directly connect to the specified address and port
            val clientSocket = Socket(host, port)
            clientSocket.tcpNoDelay = true // Set no delay

            isRunning = true

            // Create extension host manager
            val manager = ExtensionHostManager(clientSocket, projectPath, project)
            clientManagers[clientSocket] = manager
            
            // Register with PluginContext for access from UI
            project.getService(PluginContext::class.java).setExtensionHostManager(manager)

            // Start connection handling in background thread
            thread(start = true, name = "DebugHostHandler") {
                handleClient(clientSocket, manager)
            }

            logger.info("Successfully connected to debug host at $host:$port")
            return true
        } catch (e: Exception) {
            logger.error("Failed to connect to debug host at $host:$port", e)
            stop()
            return false
        }
    }
}
