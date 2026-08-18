package ai.kilocode.backend.workspace

import java.nio.file.InvalidPathException
import java.nio.file.Path

internal object RemoteDirectory {
    private val DEVCONTAINER = "/${'$'}devcontainer.ij/"
    private val WSL = "\\\\wsl${'$'}\\"
    private val WSL_LOCALHOST = "\\\\wsl.localhost\\"

    fun detect(directory: String): String? {
        forced()?.let { return it }
        val dir = directory.trim()
        if (dir.contains(DEVCONTAINER)) return "devcontainer_virtual_filesystem"
        if (dir.startsWith(WSL, ignoreCase = true)) return "wsl_virtual_filesystem"
        if (dir.startsWith(WSL_LOCALHOST, ignoreCase = true)) return "wsl_virtual_filesystem"
        return try {
            Path.of(dir).normalize()
            null
        } catch (_: InvalidPathException) {
            "invalid_virtual_path"
        }
    }

    /**
     * Dev-only override so the unsupported notice can be reproduced without a real
     * Dev Container / IJent path. Set `-Dkilo.dev.forceUnsupportedWorkspace=<reason>`
     * (or `=true`) on a dev IDE run to force every workspace into the Unsupported state.
     */
    private fun forced(): String? {
        val flag = System.getProperty("kilo.dev.forceUnsupportedWorkspace")?.trim().orEmpty()
        if (flag.isEmpty() || flag.equals("false", ignoreCase = true)) return null
        return if (flag.equals("true", ignoreCase = true)) "devcontainer_virtual_filesystem" else flag
    }
}
