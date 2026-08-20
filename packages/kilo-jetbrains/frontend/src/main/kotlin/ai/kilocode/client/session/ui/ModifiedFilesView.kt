package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionDiffOpener
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.views.tool.PatchBody
import ai.kilocode.client.ui.DiffBars
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.util.concurrency.annotations.RequiresEdt

internal class ModifiedFilesView private constructor(
    openFile: SessionFileOpener,
    selection: SessionSelection?,
    parts: ChangesCardView.Header,
    body: PatchBody,
) : ChangesCardView(openFile, selection, parts, body, linkFiles = true) {
    override val contentId = CONTENT_ID

    private var turnId: String = CONTENT_ID

    init {
        isVisible = false
    }

    constructor(
        openFile: SessionFileOpener,
        selection: SessionSelection? = null,
    ) : this(
        openFile,
        selection,
        modifiedHeader(),
        PatchBody(selection, openFile),
    )

    fun setDiffOpener(openDiff: SessionDiffOpener, sessionId: String?, turnId: String) {
        this.openDiff = openDiff
        this.sessionId = sessionId
        this.turnId = turnId
    }

    /** Returns true when anything visible changed, so the parent only relayouts on a real change. */
    @RequiresEdt
    fun setDiffs(diffs: List<DiffFileDto>): Boolean {
        if (items == diffs) {
            val visible = diffs.isNotEmpty()
            parts.diff.isEnabled = visible
            if (isVisible == visible) return false
            isVisible = visible
            revalidate()
            repaint()
            return true
        }
        val visible = diffs.isNotEmpty()
        if (isVisible != visible) isVisible = visible
        if (!visible) collapse()
        render(diffs)
        return true
    }

    @RequiresEdt
    internal fun bodyCreated() = cardBodyCreated()

    @RequiresEdt
    internal fun bodyVisible() = cardBodyAttached()

    @RequiresEdt
    internal fun countText() = parts.count.text

    override val popupKind = "tool"
    override val popupName = "changes"

    override fun openable(dto: DiffFileDto) = true

    override fun diffTitle() = KiloBundle.message("diff.editor.changedFiles.title")

    override fun diffToken() = "turn:${sessionId ?: "pending"}:$turnId"

    private companion object {
        const val CONTENT_ID = "session-modified-files"
    }
}

private fun modifiedHeader(): ChangesCardView.Header {
    val badge = DiffBars(0, 0)
    return ChangesCardView.Header(KiloBundle.message("session.changes.modified"), badge, badge)
}
