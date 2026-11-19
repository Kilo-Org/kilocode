package ai.kilocode.backend.dev

import ai.kilocode.backend.cli.CliCommand
import java.io.File
import java.nio.file.Files
import java.nio.file.Path

internal object KiloDevMode {
    /** The backend JVM receives the checkout path from runIde; never discover a script from a user's project. */
    fun command(root: String?, storage: Path, env: Map<String, String>): CliCommand? {
        if (root == null) return null
        val script = Path.of(root).resolve("script/dev-isolated.ts").toAbsolutePath()
        check(Files.isRegularFile(script)) { "Missing isolated Kilo development entry: $script" }
        val bun = if (System.getProperty("os.name").startsWith("Windows")) "bun.exe" else "bun"
        val home = env["BUN_INSTALL"]?.let(Path::of) ?: Path.of(System.getProperty("user.home"), ".bun")
        val executable = (listOf(home.resolve("bin")) + env["PATH"].orEmpty().split(File.pathSeparator)
            .filter(String::isNotBlank).map(Path::of).filter(Path::isAbsolute))
            .map { it.resolve(bun) }.firstOrNull(Files::isExecutable)?.toString() ?: bun
        return CliCommand(listOf(executable, script.toString()), mapOf(
            "KILO_V2_PROFILE" to (env["KILO_V2_PROFILE"] ?: storage.resolve("profile").toString()),
        ))
    }
}
