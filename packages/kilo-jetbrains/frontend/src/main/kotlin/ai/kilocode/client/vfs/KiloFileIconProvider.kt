package ai.kilocode.client.vfs

import com.intellij.ide.FileIconProvider
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import javax.swing.Icon

/**
 * Supplies each [KiloVirtualFileKind]'s [KiloVirtualFileKind.icon] to IntelliJ's file-icon pipeline
 * (project view rows, Search Everywhere, and editor tabs).
 *
 * [KiloVirtualFile] only overrides [KiloVirtualFile.getFileType], not an icon — `VirtualFile` has no
 * `getIcon()` to override. Icon resolution instead goes through the public [FileIconProvider]
 * extension point (queried before the file-type fallback), so without this provider every Kilo tab
 * falls back to `FileTypes.UNKNOWN`'s generic icon regardless of what a kind's `icon()` returns.
 *
 * Matches via [kiloPath] rather than `is KiloVirtualFile`, so a split-mode protocol/proxy file for
 * the same path still resolves, matching [KiloFileEditorProvider]'s own lookup.
 *
 * Must stay fast and side-effect-free: IntelliJ may call this from a background read action, in dumb
 * mode, before the editor for the file exists at all. It only derives the icon from the file's own
 * path/params, never from `SessionModel` or other EDT-only session state — see
 * [ai.kilocode.client.session.subagent.SubagentSessionEditorKind.icon].
 */
class KiloFileIconProvider : FileIconProvider {
    override fun getIcon(file: VirtualFile, flags: Int, project: Project?): Icon? {
        val path = kiloPath(file) ?: return null
        return service<KiloVirtualFileKindRegistry>().get(path.kind)?.icon(path.params)
    }
}
