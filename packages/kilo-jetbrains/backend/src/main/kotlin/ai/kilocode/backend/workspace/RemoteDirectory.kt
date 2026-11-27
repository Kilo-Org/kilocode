package ai.kilocode.backend.workspace

import java.nio.file.InvalidPathException
import java.nio.file.Path

internal object RemoteDirectory {
    private val DEVCONTAINER = "/${'$'}devcontainer.ij/"
    private val WSL = "\\\\wsl${'$'}\\"
    private val WSL_LOCALHOST = "\\\\wsl.localhost\\"

    fun detect(directory: String): String? {
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
}
