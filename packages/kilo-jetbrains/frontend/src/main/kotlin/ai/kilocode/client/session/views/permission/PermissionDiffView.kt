package ai.kilocode.client.session.views.permission

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionDiffOpener
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.PermissionFileDiff
import ai.kilocode.client.session.ui.ChangesCardView
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.views.tool.PatchBody
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.util.concurrency.annotations.RequiresEdt

/**
 * Renders proposed file changes inside a permission card with the same expandable body, popup
 * preview, and full diff-editor affordance used for modified files.
 */
internal class PermissionDiffView private constructor(
    openFile: SessionFileOpener,
    selection: SessionSelection?,
    parts: ChangesCardView.Header,
    body: PatchBody,
) : ChangesCardView(openFile, selection, parts, body, linkFiles = false) {
    override val contentId = CONTENT_ID

    private var requestId: String? = null

    constructor(
        diffs: List<PermissionFileDiff>,
        openFile: SessionFileOpener,
        selection: SessionSelection?,
    ) : this(openFile, selection, permissionHeader(), PatchBody(selection, openFile, linkFiles = false)) {
        setDiffs(diffs)
    }

    @RequiresEdt
    fun setDiffOpener(openDiff: SessionDiffOpener, sessionId: String?, requestId: String?) {
        this.openDiff = openDiff
        this.sessionId = sessionId
        this.requestId = requestId
    }

    @RequiresEdt
    fun setDiffs(value: List<PermissionFileDiff>) {
        val dtos = value.map(::dto)
        if (items == dtos) return
        render(dtos)
    }

    @RequiresEdt
    internal fun bodyCreated() = cardBodyCreated()

    @RequiresEdt
    internal fun badgeForTest() = parts.badge as DiffStatBadge

    @RequiresEdt
    internal fun openDiffForTest() = openDiffViewer()

    @RequiresEdt
    internal fun openDiffEnabledForTest() = parts.open.enabled

    @RequiresEdt
    internal fun openDiffButtonForTest() = parts.open.button

    @RequiresEdt
    internal fun openDiffAnchorForTest() = parts.open.anchor

    @RequiresEdt
    internal fun codeEditorsForTest() = cardCodeEditors()

    @RequiresEdt
    internal fun countTextForTest() = parts.count.text

    override val popupKind = "permission"
    override val popupName = "diff"

    override fun openable(dto: DiffFileDto) = hasOpenableContent(dto)

    override fun diffTitle() = KiloBundle.message("session.permission.diff")

    override fun diffToken() = "permission:${sessionId ?: "pending"}:${requestId ?: "pending"}"

    private companion object {
        const val CONTENT_ID = "permission-diff"
    }
}

private fun permissionHeader(): ChangesCardView.Header {
    val badge = DiffStatBadge(0, 0)
    return ChangesCardView.Header(KiloBundle.message("session.permission.diff"), badge, badge)
}

private fun dto(diff: PermissionFileDiff) = DiffFileDto(
    file = diff.file,
    additions = diff.additions,
    deletions = diff.deletions,
    patch = diff.patch,
    before = diff.before,
    after = diff.after,
)

private fun hasOpenableContent(dto: DiffFileDto) = !dto.patch.isNullOrBlank() || dto.before != null || dto.after != null
