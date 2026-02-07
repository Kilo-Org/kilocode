// SPDX-FileCopyrightText: 2026 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.util

import com.intellij.execution.configurations.PathEnvironmentVariableUtil
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.util.SystemInfo
import java.io.File

/**
 * Finds a usable Node.js executable for the JetBrains plugin.
 *
 * Order:
 * 1) Bundled Node.js under plugin resources
 * 2) IntelliJ PATH lookup
 * 3) Explicit environment variable overrides
 * 4) PATH directory scan
 * 5) Common Node manager install locations (nvm/fnm/asdf/volta and OS defaults)
 */
object NodeExecutableFinder {
    private val LOG = Logger.getInstance(NodeExecutableFinder::class.java)

    private data class SemanticVersion(
        val major: Int,
        val minor: Int,
        val patch: Int,
    ) : Comparable<SemanticVersion> {
        override fun compareTo(other: SemanticVersion): Int {
            return when {
                major != other.major -> major.compareTo(other.major)
                minor != other.minor -> minor.compareTo(other.minor)
                else -> patch.compareTo(other.patch)
            }
        }
    }

    data class OsInfo(
        val isWindows: Boolean,
        val isMac: Boolean,
    ) {
        companion object {
            fun current(): OsInfo = OsInfo(
                isWindows = SystemInfo.isWindows,
                isMac = SystemInfo.isMac,
            )
        }
    }

    fun findNodeExecutable(
        bundledNodeModulesDir: String?,
        osInfo: OsInfo = OsInfo.current(),
        envVars: Map<String, String> = System.getenv(),
        pathLookup: (String) -> String? = { binaryName ->
            PathEnvironmentVariableUtil.findExecutableInPathOnAnyOS(binaryName)?.absolutePath
        },
    ): String? {
        val bundledNode = findBundledNodeExecutable(bundledNodeModulesDir, osInfo)
        if (bundledNode != null) {
            LOG.info("Detected bundled Node.js executable: $bundledNode")
            return bundledNode
        }

        val systemPathNode = normalizePath(pathLookup("node"))
        if (isValidNodeBinary(systemPathNode, osInfo)) {
            LOG.info("Detected Node.js executable from IntelliJ PATH lookup: $systemPathNode")
            return systemPathNode
        }

        val explicitEnvNode = findNodeFromExplicitEnv(envVars, osInfo)
        if (explicitEnvNode != null) {
            LOG.info("Detected Node.js executable from environment override: $explicitEnvNode")
            return explicitEnvNode
        }

        val fallbackCandidates = collectFallbackCandidates(envVars, osInfo)
        val fallbackNode = findFirstValidCandidate(fallbackCandidates, osInfo)
        if (fallbackNode != null) {
            LOG.info("Detected Node.js executable from fallback scan: $fallbackNode")
        }

        return fallbackNode
    }

    private fun findBundledNodeExecutable(bundledNodeModulesDir: String?, osInfo: OsInfo): String? {
        if (bundledNodeModulesDir.isNullOrBlank()) {
            return null
        }

        val root = File(bundledNodeModulesDir)
        if (!root.exists() || !root.isDirectory) {
            return null
        }

        val candidates = if (osInfo.isWindows) {
            listOf(
                File(root, "node.exe").absolutePath,
                File(root, ".bin/node.exe").absolutePath,
                File(root, "node/bin/node.exe").absolutePath,
            )
        } else {
            listOf(
                File(root, ".bin/node").absolutePath,
                File(root, "node/bin/node").absolutePath,
            )
        }

        return findFirstValidCandidate(candidates, osInfo)
    }

    private fun findNodeFromExplicitEnv(envVars: Map<String, String>, osInfo: OsInfo): String? {
        val envKeys = listOf("KILOCODE_NODE_PATH", "KILOCODE_NODE", "NODE_BINARY", "NODE_EXECUTABLE")
        for (key in envKeys) {
            val candidate = normalizePath(getEnvValue(envVars, key))
            if (isValidNodeBinary(candidate, osInfo)) {
                return candidate
            }
        }

        return null
    }

    private fun collectFallbackCandidates(envVars: Map<String, String>, osInfo: OsInfo): List<String> {
        val candidates = linkedSetOf<String>()
        val binaryName = if (osInfo.isWindows) "node.exe" else "node"
        val homeDir = resolveHomeDirectory(envVars)

        splitPathEntries(getPathEnvValue(envVars)).forEach { pathEntry ->
            candidates.add(File(pathEntry, binaryName).absolutePath)
            if (osInfo.isWindows) {
                candidates.add(File(pathEntry, "node.cmd").absolutePath)
            }
        }

        if (!homeDir.isNullOrBlank()) {
            val home = File(homeDir)
            val nvmVersionDir = if (osInfo.isWindows) {
                File(home, "AppData/Roaming/nvm")
            } else {
                File(home, ".nvm/versions/node")
            }
            candidates.addAll(versionedNodeCandidates(nvmVersionDir, if (osInfo.isWindows) "node.exe" else "bin/node"))

            val fnmVersionDir = if (osInfo.isWindows) {
                File(home, "AppData/Local/fnm/node-versions")
            } else {
                File(home, ".fnm/node-versions")
            }
            candidates.addAll(versionedNodeCandidates(fnmVersionDir, if (osInfo.isWindows) "installation/node.exe" else "installation/bin/node"))

            candidates.add(File(home, if (osInfo.isWindows) "AppData/Local/Volta/bin/node.exe" else ".volta/bin/node").absolutePath)
            candidates.add(File(home, if (osInfo.isWindows) "AppData/Local/Microsoft/WinGet/Links/node.exe" else ".asdf/shims/node").absolutePath)
            candidates.add(File(home, ".local/bin/$binaryName").absolutePath)
        }

        if (osInfo.isWindows) {
            candidates.add(filePathIfBasePresent(getEnvValue(envVars, "NVM_SYMLINK"), "node.exe"))
            candidates.add(filePathIfBasePresent(getEnvValue(envVars, "NVM_HOME"), "node.exe"))
            candidates.add(filePathIfBasePresent(getEnvValue(envVars, "ProgramFiles"), "nodejs/node.exe"))
            candidates.add(filePathIfBasePresent(getEnvValue(envVars, "ProgramFiles(x86)"), "nodejs/node.exe"))
            candidates.add(filePathIfBasePresent(getEnvValue(envVars, "LocalAppData"), "Programs/nodejs/node.exe"))
        } else if (osInfo.isMac) {
            candidates.add("/opt/homebrew/bin/node")
            candidates.add("/usr/local/bin/node")
            candidates.add("/opt/local/bin/node")
            candidates.add("/usr/bin/node")
        } else {
            candidates.add("/usr/local/bin/node")
            candidates.add("/usr/bin/node")
            candidates.add("/snap/bin/node")
        }

        return candidates.filter { it.isNotBlank() }
    }

    private fun filePathIfBasePresent(basePath: String?, relativePath: String): String {
        val base = normalizePath(basePath)
        return if (base.isNullOrBlank()) "" else File(base, relativePath).absolutePath
    }

    private fun versionedNodeCandidates(versionRoot: File, relativeNodePath: String): List<String> {
        if (!versionRoot.exists() || !versionRoot.isDirectory) {
            return emptyList()
        }

        val versions = versionRoot.listFiles { file -> file.isDirectory }?.toList().orEmpty()
            .sortedWith(compareByDescending<File> { parseSemanticVersion(it.name) }.thenByDescending { it.name })

        return versions.map { versionDir -> File(versionDir, relativeNodePath).absolutePath }
    }

    private fun parseSemanticVersion(raw: String): SemanticVersion {
        val match = Regex("^v?(\\d+)\\.(\\d+)\\.(\\d+)").find(raw.trim())
        if (match != null) {
            return SemanticVersion(
                major = match.groupValues[1].toIntOrNull() ?: -1,
                minor = match.groupValues[2].toIntOrNull() ?: -1,
                patch = match.groupValues[3].toIntOrNull() ?: -1,
            )
        }

        return SemanticVersion(-1, -1, -1)
    }

    private fun splitPathEntries(pathValue: String?): List<String> {
        if (pathValue.isNullOrBlank()) {
            return emptyList()
        }

        return pathValue.split(File.pathSeparatorChar).map { it.trim() }.filter { it.isNotBlank() }
    }

    private fun getPathEnvValue(envVars: Map<String, String>): String? {
        return envVars.entries.firstOrNull { it.key.equals("PATH", ignoreCase = true) }?.value
    }

    private fun resolveHomeDirectory(envVars: Map<String, String>): String? {
        val home = normalizePath(getEnvValue(envVars, "HOME"))
        if (!home.isNullOrBlank()) {
            return home
        }

        val userProfile = normalizePath(getEnvValue(envVars, "USERPROFILE"))
        if (!userProfile.isNullOrBlank()) {
            return userProfile
        }

        return normalizePath(System.getProperty("user.home"))
    }

    private fun getEnvValue(envVars: Map<String, String>, key: String): String? {
        val direct = envVars[key]
        if (direct != null) {
            return direct
        }

        return envVars.entries.firstOrNull { it.key.equals(key, ignoreCase = true) }?.value
    }

    private fun normalizePath(path: String?): String? {
        return path?.trim()?.trim('"')?.takeIf { it.isNotBlank() }
    }

    private fun findFirstValidCandidate(candidates: List<String>, osInfo: OsInfo): String? {
        for (candidate in candidates) {
            if (isValidNodeBinary(candidate, osInfo)) {
                return candidate
            }
        }

        return null
    }

    private fun isValidNodeBinary(path: String?, osInfo: OsInfo): Boolean {
        if (path.isNullOrBlank()) {
            return false
        }

        val file = File(path)
        if (!file.exists() || !file.isFile) {
            return false
        }

        return osInfo.isWindows || file.canExecute()
    }
}
