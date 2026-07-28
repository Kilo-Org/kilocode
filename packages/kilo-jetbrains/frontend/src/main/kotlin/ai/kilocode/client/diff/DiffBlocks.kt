package ai.kilocode.client.diff

import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.requests.DiffRequest
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.diff.util.DiffUserDataKeys
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.project.Project

internal fun diffRequest(project: Project, dto: DiffFileDto): DiffRequest {
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
        else -> factory.create(project, dto.patch ?: "diff unavailable", type)
    }
    return SimpleDiffRequest(dto.file, left, right, "Base", "Current").also {
        it.putUserData(DiffUserDataKeys.FORCE_READ_ONLY, true)
    }
}
