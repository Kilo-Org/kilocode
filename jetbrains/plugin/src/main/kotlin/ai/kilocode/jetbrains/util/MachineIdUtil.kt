package ai.kilocode.jetbrains.util

import com.intellij.openapi.diagnostic.Logger
import java.io.File
import java.security.MessageDigest

/**
 * Utility class for generating a unique machine identifier.
 * This implementation mirrors the behavior of the node-machine-id npm package
 * to ensure consistency across CLI and JetBrains plugin.
 *
 * The machine ID is generated from platform-specific sources:
 * - Windows: MachineGuid from the Windows registry
 * - macOS: IOPlatformUUID from IOKit
 * - Linux: /var/lib/dbus/machine-id or /etc/machine-id
 *
 * The raw ID is hashed using SHA-256 to match the format produced by node-machine-id.
 */
object MachineIdUtil {
    private val LOG = Logger.getInstance(MachineIdUtil::class.java)
    private var cachedMachineId: String? = null

    /**
     * Get the machine ID, generating it if not already cached.
     * Returns a SHA-256 hash of the platform-specific machine identifier.
     */
    fun getMachineId(): String {
        cachedMachineId?.let { return it }

        val rawId = getRawMachineId()
        val hashedId = hashMachineId(rawId)
        cachedMachineId = hashedId
        LOG.info("Generated machine ID: ${hashedId.take(8)}...")
        return hashedId
    }

    /**
     * Get the raw (unhashed) machine ID for the current platform.
     */
    private fun getRawMachineId(): String {
        return when {
            isWindows() -> getWindowsMachineId()
            isMacOS() -> getMacOSMachineId()
            isLinux() -> getLinuxMachineId()
            else -> getFallbackMachineId()
        }
    }

    private fun isWindows(): Boolean =
        System.getProperty("os.name").lowercase().contains("windows")

    private fun isMacOS(): Boolean =
        System.getProperty("os.name").lowercase().contains("mac")

    private fun isLinux(): Boolean =
        System.getProperty("os.name").lowercase().contains("linux")

    /**
     * Get machine ID on Windows by reading the MachineGuid from the registry.
     */
    private fun getWindowsMachineId(): String {
        return try {
            val process = ProcessBuilder(
                "reg", "query",
                "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography",
                "/v", "MachineGuid"
            ).start()

            val output = process.inputStream.bufferedReader().readText()
            val exitCode = process.waitFor()

            if (exitCode != 0) {
                LOG.warn("Registry query failed with exit code: $exitCode")
                return getFallbackMachineId()
            }

            // Parse the registry output to extract the GUID
            // Output format: "    MachineGuid    REG_SZ    xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            val regex = Regex("MachineGuid\\s+REG_SZ\\s+([\\w-]+)")
            val match = regex.find(output)

            if (match != null) {
                match.groupValues[1]
            } else {
                LOG.warn("Could not parse MachineGuid from registry output")
                getFallbackMachineId()
            }
        } catch (e: Exception) {
            LOG.warn("Failed to get Windows machine ID", e)
            getFallbackMachineId()
        }
    }

    /**
     * Get machine ID on macOS by reading the IOPlatformUUID from IOKit.
     */
    private fun getMacOSMachineId(): String {
        return try {
            val process = ProcessBuilder(
                "ioreg", "-rd1", "-c", "IOPlatformExpertDevice"
            ).start()

            val output = process.inputStream.bufferedReader().readText()
            val exitCode = process.waitFor()

            if (exitCode != 0) {
                LOG.warn("ioreg command failed with exit code: $exitCode")
                return getFallbackMachineId()
            }

            // Parse the output to extract IOPlatformUUID
            // Output format: "IOPlatformUUID" = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            val regex = Regex("\"IOPlatformUUID\"\\s*=\\s*\"([^\"]+)\"")
            val match = regex.find(output)

            if (match != null) {
                match.groupValues[1]
            } else {
                LOG.warn("Could not parse IOPlatformUUID from ioreg output")
                getFallbackMachineId()
            }
        } catch (e: Exception) {
            LOG.warn("Failed to get macOS machine ID", e)
            getFallbackMachineId()
        }
    }

    /**
     * Get machine ID on Linux by reading from standard machine-id files.
     */
    private fun getLinuxMachineId(): String {
        return try {
            // Try /var/lib/dbus/machine-id first (D-Bus machine ID)
            val dbusFile = File("/var/lib/dbus/machine-id")
            if (dbusFile.exists() && dbusFile.canRead()) {
                val id = dbusFile.readText().trim()
                if (id.isNotEmpty()) {
                    return id
                }
            }

            // Fall back to /etc/machine-id (systemd machine ID)
            val etcFile = File("/etc/machine-id")
            if (etcFile.exists() && etcFile.canRead()) {
                val id = etcFile.readText().trim()
                if (id.isNotEmpty()) {
                    return id
                }
            }

            LOG.warn("No machine-id file found on Linux")
            getFallbackMachineId()
        } catch (e: Exception) {
            LOG.warn("Failed to get Linux machine ID", e)
            getFallbackMachineId()
        }
    }

    /**
     * Generate a fallback machine ID based on available system properties.
     * This is used when platform-specific methods fail.
     */
    private fun getFallbackMachineId(): String {
        // Generate a fallback based on available system properties
        val props = listOf(
            System.getProperty("user.name", "unknown"),
            System.getProperty("os.name", "unknown"),
            System.getProperty("os.arch", "unknown"),
            System.getProperty("user.home", "unknown"),
            System.getProperty("java.home", "unknown")
        ).joinToString("-")

        LOG.info("Using fallback machine ID generation")
        return props
    }

    /**
     * Hash the raw machine ID using SHA-256.
     * This matches the format produced by node-machine-id.
     */
    private fun hashMachineId(rawId: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hashBytes = digest.digest(rawId.toByteArray(Charsets.UTF_8))
        return hashBytes.joinToString("") { "%02x".format(it) }
    }

    /**
     * Clear the cached machine ID (useful for testing).
     */
    internal fun clearCache() {
        cachedMachineId = null
    }
}
