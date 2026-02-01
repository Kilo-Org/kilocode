package ai.kilo.plugin.services

import com.intellij.execution.wsl.WSLDistribution
import com.intellij.execution.wsl.WslPath
import com.intellij.openapi.diagnostic.Logger
import java.io.File

private val log = Logger.getInstance(KiloCliDiscovery::class.java)
private val BINARY_NAMES = listOf("kilo", "opencode")

interface OsDiscoveryStrategy {
    fun findBinary(binaryName: String): String?
}

class WindowsDiscovery : OsDiscoveryStrategy {
    private val userHome = System.getProperty("user.home")

    override fun findBinary(binaryName: String): String? {
        return findInKnownPaths(binaryName)
            ?: findViaWhere(binaryName)
            ?: findViaRegistry(binaryName)
    }

    private fun findInKnownPaths(binaryName: String): String? {
        for (path in getKnownPaths(binaryName)) {
            if (isBinaryValid(path)) {
                return path
            }
        }
        return null
    }

    private fun findViaWhere(binaryName: String): String? {
        return try {
            val process = ProcessBuilder("where", binaryName)
                .redirectErrorStream(true)
                .start()

            val output = process.inputStream.bufferedReader().readText().trim()
            if (process.waitFor() == 0 && output.isNotEmpty()) {
                val result = output.lines().firstOrNull()?.trim()
                if (!result.isNullOrEmpty() && isBinaryValid(result)) result else null
            } else null
        } catch (e: Exception) {
            log.debug("where lookup failed: ${e.message}")
            null
        }
    }

    private fun findViaRegistry(binaryName: String): String? {
        return try {
            val process = ProcessBuilder(
                "reg", "query",
                "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\$binaryName.exe",
                "/ve"
            ).redirectErrorStream(true).start()

            val output = process.inputStream.bufferedReader().readText()
            if (process.waitFor() == 0) {
                val match = Regex("""REG_SZ\s+(.+)""").find(output)
                val path = match?.groupValues?.get(1)?.trim()
                if (!path.isNullOrEmpty() && isBinaryValid(path)) path else null
            } else null
        } catch (e: Exception) {
            log.debug("Registry lookup failed: ${e.message}")
            null
        }
    }

    private fun getKnownPaths(binaryName: String): List<String> {
        val localAppData = System.getenv("LOCALAPPDATA") ?: "$userHome\\AppData\\Local"
        val roamingAppData = System.getenv("APPDATA") ?: "$userHome\\AppData\\Roaming"
        val programFiles = System.getenv("ProgramFiles") ?: "C:\\Program Files"
        val programFilesX86 = System.getenv("ProgramFiles(x86)") ?: "C:\\Program Files (x86)"

        return listOf(
            "$userHome\\.bun\\bin\\$binaryName.exe",
            "$roamingAppData\\npm\\$binaryName.cmd",
            "$roamingAppData\\npm\\$binaryName",
            "$localAppData\\npm\\$binaryName.cmd",
            "$localAppData\\npm\\$binaryName.exe",
            "$localAppData\\pnpm\\$binaryName.cmd",
            "$localAppData\\pnpm\\$binaryName.exe",
            "$userHome\\scoop\\shims\\$binaryName.exe",
            "$userHome\\scoop\\apps\\$binaryName\\current\\$binaryName.exe",
            "C:\\ProgramData\\chocolatey\\bin\\$binaryName.exe",
            "$localAppData\\Programs\\$binaryName\\$binaryName.exe",
            "$localAppData\\$binaryName\\$binaryName.exe",
            "$programFiles\\$binaryName\\$binaryName.exe",
            "$programFilesX86\\$binaryName\\$binaryName.exe",
            "$userHome\\.local\\bin\\$binaryName.exe",
        )
    }

    private fun isBinaryValid(path: String): Boolean {
        return try {
            val file = File(path)
            if (file.isAbsolute) {
                file.exists() && file.canExecute()
            } else {
                val process = ProcessBuilder(path, "--version")
                    .redirectErrorStream(true)
                    .start()
                val exited = process.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)
                exited && process.exitValue() == 0
            }
        } catch (e: Exception) {
            false
        }
    }
}

class WindowsWslDiscovery(private val distribution: WSLDistribution) : OsDiscoveryStrategy {
    private val wslUserHome: String by lazy {
        distribution.userHome ?: "/home/user"
    }


    override fun findBinary(binaryName: String): String? {
        return findInKnownPaths(binaryName)
            ?: findInFnmPaths(binaryName)
            ?: findViaWhich(binaryName)
    }

    private fun findInKnownPaths(binaryName: String): String? {
        for (path in getKnownPaths(binaryName)) {
            if (isWslBinaryValid(path)) {
                return "wsl::$path"
            }
        }
        return null
    }

    // TODO: Remove fnm support once proper binary distribution is available
    private fun findInFnmPaths(binaryName: String): String? {
        // fnm stores node versions in ~/.local/share/fnm/node-versions/
        // Global npm packages are in <version>/installation/bin/
        // See: https://github.com/Schniz/fnm
        return try {
            val fnmDir = "$wslUserHome/.local/share/fnm/node-versions"
            val result = distribution.executeOnWsl(
                5000, "find", fnmDir, "-name", binaryName, "-type", "f"
            )
            val paths = result.stdout.trim().lines().filter { it.isNotEmpty() }
            for (path in paths) {
                if (isWslBinaryValid(path)) {
                    return "wsl::$path"
                }
            }
            null
        } catch (e: Exception) {
            null
        }
    }

    private fun findViaWhich(binaryName: String): String? {
        /* TODO: Not implemented due to complexity:
         - executeOnWsl doesn't load user's shell environment (fnm, nvm, etc.)
         - Interactive shell (-i) causes "screen size bogus" warnings
         - WSL PATH includes Windows paths via /mnt/ which need filtering
         - Node version managers (fnm, nvm) require shell init scripts to set PATH
         For now, rely on findInKnownPaths which covers common installation locations
         */
        return null
    }

    private fun getKnownPaths(binaryName: String): List<String> {
        return listOf(
            "/usr/local/bin/$binaryName",
            "/usr/bin/$binaryName",
            "$wslUserHome/.bun/bin/$binaryName",
            "/usr/local/lib/node_modules/.bin/$binaryName",
            "$wslUserHome/.npm-global/bin/$binaryName",
            "$wslUserHome/.pnpm-global/bin/$binaryName",
            "$wslUserHome/.local/bin/$binaryName",
            "/snap/bin/$binaryName",
            "/home/linuxbrew/.linuxbrew/bin/$binaryName",
            "$wslUserHome/.linuxbrew/bin/$binaryName",
        )
    }

    private fun isWslBinaryValid(path: String): Boolean {
        return try {
            // Use ProcessBuilder for consistent behavior with findViaWhich
            val process = ProcessBuilder(
                "wsl", "-d", distribution.msId,
                "bash", "-l", "-i", "-c", "$path --version"
            ).redirectErrorStream(true).start()
            val exited = process.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)
            exited && process.exitValue() == 0
        } catch (e: Exception) {
            false
        }
    }
}

class MacOsDiscovery : OsDiscoveryStrategy {
    private val userHome = System.getProperty("user.home")

    override fun findBinary(binaryName: String): String? {
        return findViaHomebrew(binaryName)
            ?: findInKnownPaths(binaryName)
            ?: findViaWhich(binaryName)
    }

    private fun findViaHomebrew(binaryName: String): String? {
        return try {
            val process = ProcessBuilder("brew", "--prefix", binaryName)
                .redirectErrorStream(true)
                .start()

            val output = process.inputStream.bufferedReader().readText().trim()
            if (process.waitFor() == 0 && output.isNotEmpty()) {
                val binaryPath = "$output/bin/$binaryName"
                if (isBinaryValid(binaryPath)) binaryPath else null
            } else null
        } catch (e: Exception) {
            log.debug("Homebrew lookup failed: ${e.message}")
            null
        }
    }

    private fun findInKnownPaths(binaryName: String): String? {
        for (path in getKnownPaths(binaryName)) {
            if (isBinaryValid(path)) {
                return path
            }
        }
        return null
    }

    private fun findViaWhich(binaryName: String): String? {
        return try {
            val process = ProcessBuilder("which", binaryName)
                .redirectErrorStream(true)
                .start()

            val output = process.inputStream.bufferedReader().readText().trim()
            if (process.waitFor() == 0 && output.isNotEmpty() && isBinaryValid(output)) {
                output
            } else null
        } catch (e: Exception) {
            log.debug("which lookup failed: ${e.message}")
            null
        }
    }

    private fun getKnownPaths(binaryName: String): List<String> {
        return listOf(
            "/opt/homebrew/bin/$binaryName",
            "/usr/local/bin/$binaryName",
            "$userHome/.bun/bin/$binaryName",
            "/usr/local/lib/node_modules/.bin/$binaryName",
            "$userHome/.npm-global/bin/$binaryName",
            "$userHome/.pnpm-global/bin/$binaryName",
            "$userHome/.local/bin/$binaryName",
            "/opt/local/bin/$binaryName",
        )
    }

    private fun isBinaryValid(path: String): Boolean {
        return try {
            val file = File(path)
            if (file.isAbsolute) {
                file.exists() && file.canExecute()
            } else {
                val process = ProcessBuilder(path, "--version")
                    .redirectErrorStream(true)
                    .start()
                val exited = process.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)
                exited && process.exitValue() == 0
            }
        } catch (e: Exception) {
            false
        }
    }
}

class LinuxDiscovery : OsDiscoveryStrategy {
    private val userHome = System.getProperty("user.home")

    override fun findBinary(binaryName: String): String? {
        return findInKnownPaths(binaryName)
            ?: findViaWhich(binaryName)
    }

    private fun findInKnownPaths(binaryName: String): String? {
        for (path in getKnownPaths(binaryName)) {
            if (isBinaryValid(path)) {
                return path
            }
        }
        return null
    }

    private fun findViaWhich(binaryName: String): String? {
        return try {
            val process = ProcessBuilder("which", binaryName)
                .redirectErrorStream(true)
                .start()

            val output = process.inputStream.bufferedReader().readText().trim()
            if (process.waitFor() == 0 && output.isNotEmpty() && isBinaryValid(output)) {
                output
            } else null
        } catch (e: Exception) {
            log.debug("which lookup failed: ${e.message}")
            null
        }
    }

    private fun getKnownPaths(binaryName: String): List<String> {
        return listOf(
            "/usr/local/bin/$binaryName",
            "/usr/bin/$binaryName",
            "$userHome/.bun/bin/$binaryName",
            "/usr/local/lib/node_modules/.bin/$binaryName",
            "$userHome/.npm-global/bin/$binaryName",
            "$userHome/.pnpm-global/bin/$binaryName",
            "$userHome/.local/bin/$binaryName",
            "/snap/bin/$binaryName",
            "/var/lib/flatpak/exports/bin/$binaryName",
            "$userHome/.local/share/flatpak/exports/bin/$binaryName",
            "/home/linuxbrew/.linuxbrew/bin/$binaryName",
            "$userHome/.linuxbrew/bin/$binaryName",
        )
    }

    private fun isBinaryValid(path: String): Boolean {
        return try {
            val file = File(path)
            if (file.isAbsolute) {
                file.exists() && file.canExecute()
            } else {
                val process = ProcessBuilder(path, "--version")
                    .redirectErrorStream(true)
                    .start()
                val exited = process.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)
                exited && process.exitValue() == 0
            }
        } catch (e: Exception) {
            false
        }
    }
}

object KiloCliDiscovery {

    fun findBinary(projectPath: String? = null): String? {
        val strategy = getStrategyForOs(projectPath)
        log.info("Using discovery strategy: ${strategy::class.simpleName}, projectPath: $projectPath")

        for (binaryName in BINARY_NAMES) {
            val result = strategy.findBinary(binaryName)
            if (result != null) {
                log.info("Found binary '$binaryName': $result")
                return result
            }
        }

        log.warn("Kilo/OpenCode binary not found on system")
        return null
    }

    private fun getStrategyForOs(projectPath: String?): OsDiscoveryStrategy {
        val osName = System.getProperty("os.name").lowercase()
        return when {
            osName.contains("windows") -> {
                val wslPath = projectPath?.let { WslPath.parseWindowsUncPath(it) }
                if (wslPath != null) {
                    WindowsWslDiscovery(wslPath.distribution)
                } else {
                    WindowsDiscovery()
                }
            }

            osName.contains("mac") || osName.contains("darwin") -> MacOsDiscovery()
            else -> LinuxDiscovery()
        }
    }
}
