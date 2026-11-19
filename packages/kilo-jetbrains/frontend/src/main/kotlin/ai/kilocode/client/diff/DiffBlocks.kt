package ai.kilocode.client.diff

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.contents.DocumentContent
import com.intellij.diff.requests.DiffRequest
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.diff.util.DiffUserDataKeys
import com.intellij.diff.util.DiffUserDataKeysEx
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vcs.FileStatus
import java.util.function.IntUnaryOperator

internal fun diffRequest(
    project: Project,
    dto: DiffFileDto,
    branch: String? = null,
    labels: Pair<String, String> = KiloBundle.message("diff.editor.side.base") to KiloBundle.message("diff.editor.side.current"),
): DiffRequest {
    val sides = DiffPatchReconstruct.sides(dto)
    val type = FileTypeManager.getInstance().getFileTypeByFileName(dto.file)
    val factory = DiffContentFactory.getInstance()
    val status = fileStatus(dto)
    val patch = dto.patch?.takeIf { it.isNotBlank() }
    val fallback = patch ?: KiloBundle.message("diff.editor.patch.unavailable")
    val full = dto.before != null && dto.after != null
    val left = when {
        full -> factory.create(project, dto.before.orEmpty(), type)
        DiffPatchReconstruct.added(dto.patch) -> factory.createEmpty()
        sides.renderable -> factory.create(project, sides.before, type).numbered(sides.leftLines)
        status == FileStatus.DELETED -> factory.create(project, fallback, type)
        else -> factory.createEmpty()
    }
    val right = when {
        full -> factory.create(project, dto.after.orEmpty(), type)
        DiffPatchReconstruct.deleted(dto.patch) -> factory.createEmpty()
        sides.renderable -> factory.create(project, sides.after, type).numbered(sides.rightLines)
        status == FileStatus.DELETED -> factory.createEmpty()
        else -> factory.create(project, fallback, type)
    }
    return SimpleDiffRequest(diffTitle(dto.file, branch), left, right, labels.first, labels.second).also {
        it.putUserData(DiffUserDataKeys.FORCE_READ_ONLY, true)
    }
}

internal fun diffTitle(file: String, branch: String?): String {
    val name = branch.takeIf { !it.isNullOrBlank() } ?: return file
    return KiloBundle.message("diff.editor.file.title", file, name)
}

// The hunk-fallback content is a concatenation of hunk bodies, so its own document lines restart at 1.
// Remap each document line to its real source-file line (0-based; the platform adds 1) so the gutter
// matches the file instead of showing 1..N. Lines with no mapping return -1 and the platform hides them.
private fun DocumentContent.numbered(lines: List<Int>): DocumentContent = apply {
    if (lines.isNotEmpty()) putUserData(DiffUserDataKeysEx.LINE_NUMBER_CONVERTOR, IntUnaryOperator { lines.getOrElse(it) { -1 } })
}
