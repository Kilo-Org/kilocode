package ai.kilocode.client.diff

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.requests.DiffRequest
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.diff.util.DiffUserDataKeys
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.project.Project

internal fun diffRequest(
    project: Project,
    dto: DiffFileDto,
    branch: String? = null,
    labels: Pair<String, String> = KiloBundle.message("diff.editor.side.base") to KiloBundle.message("diff.editor.side.current"),
): DiffRequest {
    val sides = DiffPatchReconstruct.sides(dto)
    val type = FileTypeManager.getInstance().getFileTypeByFileName(dto.file)
    val factory = DiffContentFactory.getInstance()
    val left = when {
        DiffPatchReconstruct.added(dto.patch) -> factory.createEmpty()
        sides.renderable -> factory.create(project, sides.before, type)
        else -> factory.createEmpty()
    }
    val right = when {
        DiffPatchReconstruct.deleted(dto.patch) -> factory.createEmpty()
        sides.renderable -> factory.create(project, sides.after, type)
        else -> factory.create(project, dto.patch ?: KiloBundle.message("diff.editor.patch.unavailable"), type)
    }
    return SimpleDiffRequest(diffTitle(dto.file, branch), left, right, labels.first, labels.second).also {
        it.putUserData(DiffUserDataKeys.FORCE_READ_ONLY, true)
    }
}

internal fun diffTitle(file: String, branch: String?): String {
    val name = branch.takeIf { !it.isNullOrBlank() } ?: return file
    return KiloBundle.message("diff.editor.file.title", file, name)
}
