package ai.kilocode.client.diff

import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangeRepositoryDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangesDto
import ai.kilocode.rpc.dto.HostedWorkspaceComparisonDto
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDiffDto
import com.intellij.diff.chains.DiffRequestProducer
import com.intellij.diff.requests.DiffRequest
import com.intellij.diff.requests.MessageDiffRequest
import com.intellij.openapi.components.service
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.progress.runBlockingCancellable
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Key
import com.intellij.openapi.util.UserDataHolder
import com.intellij.util.concurrency.annotations.RequiresBackgroundThread
import kotlinx.coroutines.CancellationException
import java.util.concurrent.atomic.AtomicBoolean

internal val HOSTED_RETRY_KEY: Key<Boolean> = Key.create("kilo.diff.hosted.retry")

internal data class HostedDiffEntry(
    val path: String,
    val repository: HostedWorkspaceChangeRepositoryDto?,
    val scope: String?,
    val status: String,
    val additions: Long,
    val deletions: Long,
    val revision: Long? = null,
    val comparison: HostedWorkspaceComparisonDto? = null,
    val omitted: String? = null,
    val previous: String? = null,
) {
    // Length framing avoids collisions without changing opaque producer paths into OS paths.
    val key: String = "file:" + listOf(repository?.path, repository?.repoFullName, scope, path)
        .joinToString("") { if (it == null) "-1:" else "${it.length}:$it" }
    val group: String? = repository?.let { "${it.repoFullName} (${it.path.ifEmpty { "." }})" }
    fun file(): DiffFileDto = DiffFileDto(key, additions.projected(), deletions.projected(), status = status)
}

internal class HostedDiffSnapshot(
    val source: HostedDiffSource,
    val entries: List<HostedDiffEntry> = emptyList(),
    val revision: Long? = null,
    val head: String? = null,
    val notices: List<String> = emptyList(),
    val message: String = KiloBundle.message("diff.editor.empty"),
    val refresh: String? = null,
) {
    private val valid = AtomicBoolean(true)
    private val index = entries.associateBy { it.key }
    val files: List<DiffFileDto> = entries.map { it.file() }
    fun invalidate() { valid.set(false) }
    fun entry(key: String): HostedDiffEntry? = index[key]

    fun producer(project: Project, entry: HostedDiffEntry): DiffRequestProducer = object : DiffRequestProducer {
        override fun getName(): String = entry.path

        // CacheDiffRequestChainProcessor invokes this synchronous platform boundary off the EDT.
        @RequiresBackgroundThread
        override fun process(context: UserDataHolder, indicator: ProgressIndicator): DiffRequest = runBlockingCancellable {
            indicator.checkCanceled()
            if (!source.current(project)) return@runBlockingCancellable unavailable(project, entry)
            if (!valid.get()) return@runBlockingCancellable message(entry, stale())
            val request = try {
                request(project, entry)
            } catch (err: CancellationException) {
                throw err
            } catch (err: ProcessCanceledException) {
                throw err
            } catch (_: Exception) {
                message(entry, "unavailable")
            }
            indicator.checkCanceled()
            if (!source.current(project)) return@runBlockingCancellable unavailable(project, entry)
            if (!valid.get()) return@runBlockingCancellable message(entry, stale())
            request.also { it.putUserData(DIFF_FILE_KEY, entry.key) }
        }
    }

    private suspend fun request(project: Project, entry: HostedDiffEntry): DiffRequest {
        entry.omitted?.let { return message(entry, "file.omitted.$it") }
        val service = project.service<KiloHostedService>()
        if (source.comparison == HostedDiffComparison.PULL_REQUEST) {
            val expected = head ?: return message(entry, "pr.unverified")
            val result = service.workspacePullRequestDiffFile(source.ref, entry.path, expected)
            if (result.path != entry.path) return message(entry, "inconsistent")
            if (result.status == "available" && result.headSha == expected) return patch(project, entry, result.patch)
            if (result.status == "omitted" && result.headSha == expected) {
                return message(entry, "file.omitted.${result.omissionReason ?: "provider_omitted"}")
            }
            return message(entry, when (result.status) {
                "stale" -> "pr.stale"
                "not_listed" -> "file.noLongerListed"
                else -> prMessage(result.status)
            })
        }
        val expected = entry.revision ?: return message(entry, "notCaptured")
        val result = service.workspaceChangeFile(source.ref, entry.path, entry.scope, expected)
        val file = result.file
        if (result.status == "available" || result.status == "omitted") {
            if (file == null || file.path != entry.path || file.scope != entry.scope || file.revision != expected) {
                return message(entry, "inconsistent")
            }
            if (result.status == "omitted") return message(entry, "file.omitted.${file.diff.reason ?: "capture_failed"}")
            if (file.diff.status != "available") return message(entry, "inconsistent")
            return patch(project, entry, file.diff.patch)
        }
        return message(entry, when (result.status) {
            "stale" -> "file.stale"
            "no_longer_listed" -> "file.noLongerListed"
            "not_captured" -> "notCaptured"
            else -> "unavailable"
        })
    }

    private fun patch(project: Project, entry: HostedDiffEntry, patch: String?): DiffRequest {
        val dto = entry.file().copy(file = entry.path, patch = patch)
        // Never use the record's single captured content side as invented whole-file before/after.
        if (!DiffPatchReconstruct.sides(dto).renderable) return message(entry, "file.omitted.inconsistent")
        return diffRequest(project, dto, labels = source.comparison.labels())
    }

    private fun message(entry: HostedDiffEntry, key: String): DiffRequest =
        MessageDiffRequest(entry.path, KiloBundle.message("diff.editor.hosted.$key")).also {
            it.putUserData(DIFF_FILE_KEY, entry.key)
        }

    private fun unavailable(project: Project, entry: HostedDiffEntry): DiffRequest {
        val reason = source.reason(project)
        return message(entry, reason ?: "unavailable").apply {
            if (reason == null) putUserData(HOSTED_RETRY_KEY, true)
        }
    }

    private fun stale(): String = if (source.comparison == HostedDiffComparison.PULL_REQUEST) "pr.stale" else "file.stale"

    companion object {
        fun workspace(source: HostedDiffSource, dto: HostedWorkspaceChangesDto, refresh: String? = null): HostedDiffSnapshot {
            if (dto.ref != source.ref) return HostedDiffSnapshot(source, message = text("inconsistent"), refresh = refresh)
            if (dto.status != "captured") return HostedDiffSnapshot(
                source, message = text(if (dto.status == "not_captured") "notCaptured" else "inconsistent"), refresh = refresh,
            )
            val comparisons = dto.comparisons.orEmpty()
            val metadata = comparisons.flatMap { it.files }
            val entries = comparisons.flatMap { comparison ->
                comparison.files.filter { it.scope == source.comparison.scope }.map { file ->
                    HostedDiffEntry(
                        file.path, file.repository ?: comparison.repository, file.scope, file.status,
                        file.additions, file.deletions, file.revision, comparison.comparison,
                        file.diff.reason.takeIf { file.diff.status == "omitted" },
                    )
                }
            }.sortedWith(compareBy({ it.repository?.path.orEmpty() }, { it.repository?.repoFullName.orEmpty() }, { it.path }))
            // The file endpoint has no repository parameter; a duplicate raw path/scope is unrequestable.
            if (entries.groupBy { it.path to it.scope }.any { it.value.size != 1 }) {
                return HostedDiffSnapshot(source, message = text("file.ambiguous"), refresh = refresh)
            }
            val notices = buildList {
                add(KiloBundle.message("diff.editor.hosted.snapshot", dto.capturedAt.orEmpty(), dto.revision.toString()))
                if (dto.truncated || comparisons.any { it.truncated }) add(text("truncated"))
                if (metadata.any { it.scope == null }) add(text("scope.unspecified"))
                if (metadata.any { !it.countsComplete } || entries.incomplete()) add(text("counts.incomplete"))
            }
            return HostedDiffSnapshot(source, entries, dto.revision, notices = notices, refresh = refresh)
        }

        fun pullRequest(source: HostedDiffSource, dto: HostedWorkspacePullRequestDiffDto, refresh: Boolean = false): HostedDiffSnapshot {
            if (dto.ref != source.ref) return HostedDiffSnapshot(source, message = text("inconsistent"))
            val pull = dto.pullRequest
            if (dto.status != "linked" || pull == null) return HostedDiffSnapshot(
                source, message = text(prMessage(dto.status)), refresh = "failed".takeIf { refresh && dto.status == "unavailable" },
            )
            if (dto.files.groupBy { it.path }.any { it.value.size != 1 }) {
                return HostedDiffSnapshot(source, message = text("file.ambiguous"))
            }
            val entries = dto.files.map { file ->
                HostedDiffEntry(
                    file.path, pull.repository, null, if (file.status == "removed") "deleted" else file.status,
                    file.additions, file.deletions, omitted = "provider_omitted".takeUnless { file.patchAvailable },
                    previous = file.previousPath,
                )
            }.sortedBy { it.path }
            return HostedDiffSnapshot(source, entries, head = pull.headSha, notices = buildList {
                add(KiloBundle.message("diff.editor.hosted.pr.head", pull.headSha))
                if (dto.truncated) add(text("truncated"))
                if (pull.cacheStale) add(text("pr.cacheStale"))
                if (entries.incomplete()) add(text("counts.incomplete"))
            })
        }
    }
}

internal suspend fun loadHostedDiff(project: Project, source: HostedDiffSource, refresh: Boolean): DiffEditorData.Files {
    fun unavailable(): DiffEditorData.Files {
        val reason = source.reason(project)
        return HostedDiffSnapshot(source, message = text(reason ?: "unavailable"),
            refresh = "failed".takeIf { refresh && reason == null }).data()
    }
    if (!source.current(project)) return unavailable()
    val service = project.service<KiloHostedService>()
    val snapshot = when {
        source.comparison == HostedDiffComparison.PULL_REQUEST -> HostedDiffSnapshot.pullRequest(source, service.workspacePullRequestDiff(source.ref), refresh)
        refresh -> service.refreshWorkspaceChanges(source.ref).let { HostedDiffSnapshot.workspace(source, it.changes, it.status) }
        else -> HostedDiffSnapshot.workspace(source, service.workspaceChanges(source.ref))
    }
    if (!source.current(project)) return unavailable()
    return snapshot.data()
}

internal fun HostedDiffSnapshot.data(): DiffEditorData.Files = DiffEditorData.Files(files, hosted = this)

private fun text(key: String): String = KiloBundle.message("diff.editor.hosted.$key")
private fun Long.projected(): Int = coerceIn(0, Int.MAX_VALUE.toLong()).toInt()
private fun List<HostedDiffEntry>.incomplete(): Boolean =
    sumOf { it.additions.coerceAtMost(Int.MAX_VALUE.toLong() + 1) } > Int.MAX_VALUE ||
        sumOf { it.deletions.coerceAtMost(Int.MAX_VALUE.toLong() + 1) } > Int.MAX_VALUE

private fun prMessage(status: String): String = when (status) {
    "not_linked" -> "pr.notLinked"
    "unverified" -> "pr.unverified"
    "credential_required" -> "pr.credentials"
    "not_github" -> "pr.notGithub"
    "stale" -> "pr.stale"
    else -> "pr.unavailable"
}
