package ai.kilocode.client.session.history

import java.io.File
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/**
 * Resolves the origin remote URL for a given directory by running
 * `git remote get-url origin` as a subprocess.
 *
 * Returns null when the directory is not a git repo, has no origin remote,
 * or the command fails for any reason.
 *
 * Overridable in tests via [resolve] parameter.
 */
internal fun resolveGitRemoteUrl(dir: String): String? = runCatching {
    val proc = ProcessBuilder("git", "remote", "get-url", "origin")
        .directory(File(dir))
        .redirectErrorStream(true)
        .start()

    val text = CompletableFuture.supplyAsync {
        proc.inputStream.bufferedReader().use { it.readText() }
    }
    val done = proc.waitFor(5, TimeUnit.SECONDS)
    if (!done) {
        proc.destroyForcibly()
        return@runCatching null
    }

    val out = text.get(1, TimeUnit.SECONDS).trim()
    val code = proc.exitValue()
    if (code == 0 && out.isNotEmpty()) out else null
}.getOrNull()
