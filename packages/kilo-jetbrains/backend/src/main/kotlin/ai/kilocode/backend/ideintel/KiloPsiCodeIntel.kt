package ai.kilocode.backend.ideintel

import ai.kilocode.backend.cli.IdeLspEntryInfo
import ai.kilocode.backend.cli.IdeLspRequestInfo
import ai.kilocode.backend.cli.IdeLspResultInfo
import ai.kilocode.log.KiloLog
import com.intellij.openapi.application.readAction
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.DumbService
import com.intellij.openapi.project.IndexNotReadyException
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.roots.ProjectFileIndex
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiManager
import com.intellij.psi.PsiNamedElement
import com.intellij.psi.search.GlobalSearchScope
import com.intellij.psi.search.searches.DefinitionsScopedSearch
import com.intellij.psi.search.searches.ReferencesSearch
import com.intellij.psi.util.PsiTreeUtil
import java.nio.file.InvalidPathException
import java.nio.file.Path

object KiloPsiCodeIntel {
    private val LOG = KiloLog.create(KiloPsiCodeIntel::class.java)

    suspend fun handle(directory: String, request: IdeLspRequestInfo): IdeLspResultInfo {
        val base = path(directory) ?: throw CodeIntelFailure("invalid_path", "Invalid workspace path")
        val file = path(request.filePath) ?: throw CodeIntelFailure("invalid_path", "Invalid file path")
        if (!file.startsWith(base)) throw CodeIntelFailure("invalid_path", "File is outside the workspace")
        val project = project(file) ?: project(base)
            ?: return unavailable(request.operation, "no IntelliJ project is open for this workspace")
        if (DumbService.getInstance(project).isDumb) return indexing(request.operation)
        return try {
            readAction { execute(project, base, file, request) }
        } catch (e: IndexNotReadyException) {
            indexing(request.operation)
        } catch (e: LinkageError) {
            LOG.warn("IDE code intelligence API unavailable for ${request.operation}", e)
            unavailable(request.operation, "code intelligence is not supported for this file's language")
        }
    }

    private fun indexing(op: String) = IdeLspResultInfo(op, status = "indexing")

    private fun unavailable(op: String, reason: String) = IdeLspResultInfo(op, status = "unavailable", reason = reason)

    /** True for operations that resolve a specific file position; workspaceSymbol searches globally. */
    private fun needsFile(op: String) = op != "workspaceSymbol"

    private fun execute(project: Project, base: Path, file: Path, request: IdeLspRequestInfo): IdeLspResultInfo {
        // Guard against false negatives: when the file is not part of the imported project model (e.g. the
        // project is only opened as a directory tree and has not been imported), PSI resolve/search return
        // empty results that must not be reported as authoritative "no results".
        if (needsFile(request.operation)) {
            val vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(file.toString())
                ?: return unavailable(request.operation, "the file is not available in the IDE")
            if (!ProjectFileIndex.getInstance(project).isInProject(vf))
                return unavailable(
                    request.operation,
                    "the file is not part of the imported project model; the project may not be imported yet",
                )
        }
        return when (request.operation) {
            "goToDefinition" -> IdeLspResultInfo(request.operation, entries = definition(project, file, request))
            "findReferences" -> IdeLspResultInfo(request.operation, entries = references(project, file, request))
            "goToImplementation" -> IdeLspResultInfo(request.operation, entries = implementations(project, file, request))
            "workspaceSymbol" -> IdeLspResultInfo(request.operation, entries = workspaceSymbols(project, base, request.query.orEmpty()))
            "documentSymbol" -> IdeLspResultInfo(request.operation, entries = documentSymbols(project, file))
            "typeHierarchy" -> hierarchy(project, file, request)
            else -> throw CodeIntelFailure("unsupported", "Unsupported IDE code intelligence operation: ${request.operation}")
        }
    }

    private fun definition(project: Project, file: Path, request: IdeLspRequestInfo): List<IdeLspEntryInfo> {
        val element = element(project, file, request) ?: return emptyList()
        val resolved = referenceTarget(element) ?: named(element) ?: return emptyList()
        return listOfNotNull(entry(resolved))
    }

    private fun references(project: Project, file: Path, request: IdeLspRequestInfo): List<IdeLspEntryInfo> {
        val element = element(project, file, request) ?: return emptyList()
        val target = referenceTarget(element) ?: named(element) ?: return emptyList()
        val scope = GlobalSearchScope.projectScope(project)
        return ReferencesSearch.search(target, scope).findAll().asSequence()
            .mapNotNull { entry(it.element) }
            .distinctBy { listOf(it.filePath, it.startLine, it.endLine, it.name, it.kind) }
            .take(500)
            .toList()
    }

    private fun implementations(project: Project, file: Path, request: IdeLspRequestInfo): List<IdeLspEntryInfo> {
        val element = element(project, file, request) ?: return emptyList()
        val target = referenceTarget(element) ?: named(element) ?: element
        val scope = GlobalSearchScope.projectScope(project)
        return DefinitionsScopedSearch.search(target, scope, false).findAll().asSequence()
            .mapNotNull { entry(it) }
            .distinctBy { listOf(it.filePath, it.startLine, it.endLine, it.name, it.kind) }
            .take(500)
            .toList()
    }

    private fun workspaceSymbols(project: Project, base: Path, query: String): List<IdeLspEntryInfo> {
        val text = query.trim()
        if (text.isBlank()) return emptyList()
        val index = ProjectFileIndex.getInstance(project)
        val result = mutableListOf<IdeLspEntryInfo>()
        index.iterateContent { file ->
            if (result.size >= 500) return@iterateContent false
            if (file.isDirectory || path(file.path)?.startsWith(base) != true) return@iterateContent true
            val psi = PsiManager.getInstance(project).findFile(file) ?: return@iterateContent true
            PsiTreeUtil.findChildrenOfType(psi, PsiNamedElement::class.java)
                .asSequence()
                .filter { it.name?.contains(text, ignoreCase = true) == true }
                .mapNotNull { entry(it) }
                .forEach { entry ->
                    if (result.size < 500) result.add(entry)
                }
            result.size < 500
        }
        return result.distinctBy { listOf(it.filePath, it.startLine, it.endLine, it.name, it.kind) }
    }

    private fun documentSymbols(project: Project, file: Path): List<IdeLspEntryInfo> {
        val psi = psi(project, file) ?: return emptyList()
        return PsiTreeUtil.findChildrenOfType(psi, PsiNamedElement::class.java).asSequence()
            .mapNotNull { entry(it) }
            .distinctBy { listOf(it.filePath, it.startLine, it.endLine, it.name, it.kind) }
            .take(500)
            .toList()
    }

    private fun hierarchy(project: Project, file: Path, request: IdeLspRequestInfo): IdeLspResultInfo {
        val element = element(project, file, request) ?: return IdeLspResultInfo(request.operation, supertypes = emptyList(), subtypes = emptyList())
        return IdeLspResultInfo(request.operation, entries = listOfNotNull(entry(element)), supertypes = emptyList(), subtypes = emptyList())
    }

    private fun element(project: Project, file: Path, request: IdeLspRequestInfo): PsiElement? {
        val psi = psi(project, file) ?: return null
        val vf = psi.virtualFile ?: return null
        val doc = FileDocumentManager.getInstance().getDocument(vf) ?: return null
        val line = ((request.line ?: 1) - 1).coerceIn(0, (doc.lineCount - 1).coerceAtLeast(0))
        val start = doc.getLineStartOffset(line)
        val end = doc.getLineEndOffset(line)
        val column = ((request.character ?: 1) - 1).coerceAtLeast(0)
        val offset = (start + column).coerceIn(start, end)
        return psi.findElementAt(offset) ?: psi.findElementAt((offset - 1).coerceAtLeast(0))
    }

    private fun psi(project: Project, file: Path) =
        LocalFileSystem.getInstance().refreshAndFindFileByPath(file.toString())
            ?.let { PsiManager.getInstance(project).findFile(it) }

    private fun referenceTarget(element: PsiElement): PsiElement? {
        val chain = generateSequence(element) { it.parent }.take(8)
        return chain.firstNotNullOfOrNull { item -> item.reference?.resolve() }
    }

    private fun named(element: PsiElement): PsiNamedElement? =
        element as? PsiNamedElement ?: PsiTreeUtil.getParentOfType(element, PsiNamedElement::class.java, false)

    private fun entry(element: PsiElement): IdeLspEntryInfo? {
        val item = element.navigationElement ?: element
        val file = item.containingFile?.virtualFile ?: return null
        val doc = FileDocumentManager.getInstance().getDocument(file) ?: return null
        val range = item.textRange ?: return null
        val start = doc.getLineNumber(range.startOffset.coerceIn(0, doc.textLength)) + 1
        val offset = range.endOffset.coerceIn(range.startOffset, doc.textLength)
        val end = doc.getLineNumber(offset) + 1
        val text = item.text?.lineSequence()?.take(5)?.joinToString("\n")?.take(2_000)
        return IdeLspEntryInfo(
            name = (item as? PsiNamedElement)?.name,
            kind = item::class.java.simpleName,
            filePath = file.path,
            startLine = start,
            endLine = end,
            preview = text,
        )
    }

    private fun project(path: Path): Project? {
        val projects = ProjectManager.getInstance().openProjects.filter { !it.isDefault }
        return projects.sortedByDescending { it.basePath?.length ?: 0 }.firstOrNull { item ->
            val base = item.basePath?.let(::path) ?: return@firstOrNull false
            path.startsWith(base)
        } ?: projects.firstOrNull()
    }

    private fun path(value: String): Path? = try {
        Path.of(value).normalize()
    } catch (_: InvalidPathException) {
        null
    }
}

class CodeIntelFailure(val code: String, override val message: String) : RuntimeException(message)
