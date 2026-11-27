package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.vfs.VirtualFile
import javax.swing.Icon

object WorktreeSessionFileType : FileType {
    override fun getName(): String = "KILO_WORKTREE_SESSION"
    override fun getDisplayName(): String = KiloBundle.message("worktree.session.fileType.displayName")
    override fun getDescription(): String = KiloBundle.message("worktree.session.fileType.description")
    override fun getDefaultExtension(): String = "kilo-worktree-session"
    override fun getIcon(): Icon = WorktreeIcons.branch
    override fun isBinary(): Boolean = true
    override fun isReadOnly(): Boolean = true
    override fun getCharset(file: VirtualFile, content: ByteArray): String? = null
}
