package ai.kilocode.client.migration

import ai.kilocode.client.session.SessionUiTestBase
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.migration.ui.MigrationItemRow
import ai.kilocode.client.migration.ui.MigrationOverlayPanel
import ai.kilocode.client.migration.ui.MigrationWizardPanel
import ai.kilocode.client.ui.layout.Align
import ai.kilocode.rpc.dto.LegacyMigrationDetectionDto
import ai.kilocode.rpc.dto.LegacyMigrationResultItemDto
import ai.kilocode.rpc.dto.LegacyMigrationSessionProgressDto
import ai.kilocode.rpc.dto.MigrationItemCategoryDto
import ai.kilocode.rpc.dto.MigrationItemProgressStatusDto
import ai.kilocode.rpc.dto.MigrationItemStatusDto
import ai.kilocode.rpc.dto.MigrationProviderInfoDto
import ai.kilocode.rpc.dto.MigrationSessionInfoDto
import ai.kilocode.rpc.dto.MigrationSessionPhaseDto
import java.awt.Container
import java.awt.Rectangle
import javax.swing.AbstractButton
import javax.swing.JLabel

@Suppress("UnstableApiUsage")
class SessionUiMigrationTest : SessionUiTestBase() {

    private lateinit var fakeMigration: FakeMigrationUiController

    override fun setUp() {
        super.setUp()
        // Replace the default UI with one using our observable fake migration controller.
        fakeMigration = FakeMigrationUiController()
        ui = newUi(migration = fakeMigration)
        layout()
    }

    fun `test hidden migration state keeps blocker hidden`() {
        val root = find<SessionRootPanel>(ui)
        fakeMigration._state.value = MigrationUiState.Hidden
        settle()
        assertFalse(root.blocker.isVisible)
    }

    fun `test visible migration state shows root blocker`() {
        val root = find<SessionRootPanel>(ui)
        fakeMigration._state.value = MigrationUiState.Needed(detection = sampleDetection())
        settle()
        layout()
        assertTrue("blocker should be visible", root.blocker.isVisible)
        assertTrue("blocker should be opaque", root.blocker.isOpaque)
        assertEquals(Rectangle(0, 0, root.width, root.height), root.blocker.bounds)
        assertEquals(1, root.blocker.componentCount)
    }

    fun `test visible migration state lays out content before resize`() {
        fakeMigration._state.value = MigrationUiState.Needed(detection = sampleDetection())
        settle()

        val row = find<MigrationItemRow>(ui)
        assertTrue("migration row should be visible", row.isVisible)
        assertTrue("migration row width should be laid out before resize: ${row.bounds}", row.width > 0)
        assertTrue("migration row height should be laid out before resize: ${row.bounds}", row.height > 0)
    }

    fun `test migration opens on selection screen with keep file checked`() {
        fakeMigration._state.value = MigrationUiState.Needed(detection = sampleDetection())
        settle()

        val wizard = find<MigrationWizardPanel>(ui)
        assertTrue(wizard.keepLegacySettingsFileSelectedForTest())
    }

    fun `test migration wizard is centered in overlay`() {
        fakeMigration._state.value = MigrationUiState.Needed(detection = sampleDetection())
        settle()
        layout()

        val overlay = find<MigrationOverlayPanel>(ui)
        overlay.doLayout()
        val align = find<Align>(overlay)
        align.doLayout()
        val wizard = find<MigrationWizardPanel>(overlay)

        assertTrue("align wrapper should fill most overlay width", align.width > overlay.width / 2)
        assertTrue("align wrapper should fill most overlay height", align.height > overlay.height / 2)
        assertTrue("wizard should be horizontally centered: ${wizard.bounds} in ${align.bounds}", kotlin.math.abs(wizard.x - (align.width - wizard.width) / 2) <= 1)
        assertTrue("wizard should be vertically centered: ${wizard.bounds} in ${align.bounds}", kotlin.math.abs(wizard.y - (align.height - wizard.height) / 2) <= 1)
    }

    fun `test hidden state after visible hides blocker`() {
        val root = find<SessionRootPanel>(ui)
        fakeMigration._state.value = MigrationUiState.Needed(detection = sampleDetection())
        settle()
        assertTrue(root.blocker.isVisible)

        fakeMigration._state.value = MigrationUiState.Hidden
        settle()
        assertFalse(root.blocker.isVisible)
        assertEquals(0, root.blocker.componentCount)
    }

    fun `test two session UIs sharing one controller both react to state change`() {
        val ui2 = newUi(migration = fakeMigration)
        ui2.setSize(800, 600)
        try {
            fakeMigration._state.value = MigrationUiState.Needed(detection = sampleDetection())
            settle()

            val root1 = find<SessionRootPanel>(ui)
            val root2 = find<SessionRootPanel>(ui2)
            assertTrue("ui1 blocker should be visible", root1.blocker.isVisible)
            assertTrue("ui2 blocker should be visible", root2.blocker.isVisible)
        } finally {
            com.intellij.openapi.util.Disposer.dispose(ui2)
        }
    }

    fun `test default focused component is migration overlay when blocked`() {
        fakeMigration._state.value = MigrationUiState.Needed(detection = sampleDetection())
        settle()
        val root = find<SessionRootPanel>(ui)
        assertTrue("blocker should be visible for defaultFocused test", root.blocker.isVisible)
        val overlay = find<MigrationOverlayPanel>(ui)
        assertSame(overlay.preferredFocusComponent(), ui.defaultFocusedComponent)
        assertNotSame(find<PromptPanel>(ui).defaultFocusedComponent, ui.defaultFocusedComponent)
    }

    fun `test migration modal covers prompt with opaque background`() {
        fakeMigration._state.value = MigrationUiState.Needed(detection = sampleDetection())
        settle()
        layout()
        val root = find<SessionRootPanel>(ui)

        assertTrue(root.blocker.isVisible)
        assertTrue(root.blocker.isOpaque)
        assertEquals(Rectangle(0, 0, root.width, root.height), root.blocker.bounds)
    }

    fun `test migration row keeps preferred height and identity while migrating`() {
        val det = sampleDetection()
        fakeMigration._state.value = MigrationUiState.Needed(detection = det)
        settle()

        val wizard = find<MigrationWizardPanel>(ui)
        val row = find<MigrationItemRow>(wizard)
        val count = row.componentCount
        val height = row.preferredSize.height

        fakeMigration._state.value = MigrationUiState.Needed(
            detection = det,
            phase = MigrationUiPhase.migrating,
            running = true,
            progress = listOf(
                MigrationItemUiProgress(
                    item = "profile1",
                    category = MigrationItemCategoryDto.provider,
                    status = MigrationItemProgressStatusDto.migrating,
                ),
            ),
        )
        settle()

        assertSame(wizard, find<MigrationWizardPanel>(ui))
        assertSame(row, find<MigrationItemRow>(wizard))
        assertEquals(count, row.componentCount)
        assertEquals(height, row.preferredSize.height)

        fakeMigration._state.value = MigrationUiState.Needed(
            detection = det,
            phase = MigrationUiPhase.done,
            progress = listOf(
                MigrationItemUiProgress(
                    item = "profile1",
                    category = MigrationItemCategoryDto.provider,
                    status = MigrationItemProgressStatusDto.success,
                ),
            ),
        )
        settle()

        assertSame(wizard, find<MigrationWizardPanel>(ui))
        assertSame(row, find<MigrationItemRow>(wizard))
        assertEquals(count, row.componentCount)
        assertEquals(height, row.preferredSize.height)
    }

    fun `test session migration progress does not show separate counter`() {
        val det = sampleDetection().copy(
            sessions = listOf(MigrationSessionInfoDto("ses_1", "Session", "/tmp", 1L)),
        )
        fakeMigration._state.value = MigrationUiState.Needed(
            detection = det,
            phase = MigrationUiPhase.migrating,
            running = true,
            progress = listOf(
                MigrationItemUiProgress(
                    item = "ses_1",
                    category = MigrationItemCategoryDto.session,
                    status = MigrationItemProgressStatusDto.migrating,
                ),
            ),
            sessionProgress = LegacyMigrationSessionProgressDto(
                session = det.sessions.single(),
                index = 0,
                total = 1,
                phase = MigrationSessionPhaseDto.preparing,
            ),
        )
        settle()

        val wizard = find<MigrationWizardPanel>(ui)
        assertFalse(hasText(wizard, "Migrating 1 of 1"))
    }

    fun `test session migration summary does not show separate report UI`() {
        val det = sampleDetection().copy(
            sessions = listOf(MigrationSessionInfoDto("ses_1", "Session", "/tmp", 1L)),
        )
        fakeMigration._state.value = MigrationUiState.Needed(
            detection = det,
            phase = MigrationUiPhase.done,
            progress = listOf(
                MigrationItemUiProgress(
                    item = "ses_1",
                    category = MigrationItemCategoryDto.session,
                    status = MigrationItemProgressStatusDto.success,
                ),
            ),
            sessionProgress = LegacyMigrationSessionProgressDto(
                session = null,
                index = 1,
                total = 1,
                phase = MigrationSessionPhaseDto.summary,
            ),
            sessionSummary = SessionMigrationSummary(
                imported = listOf(
                    LegacyMigrationResultItemDto(
                        item = "ses_1",
                        category = MigrationItemCategoryDto.session,
                        status = MigrationItemStatusDto.success,
                    ),
                ),
            ),
        )
        settle()

        val wizard = find<MigrationWizardPanel>(ui)
        assertFalse(hasText(wizard, "1 imported"))
        assertFalse(hasText(wizard, "0 errored"))
        assertFalse(hasText(wizard, "Copy Report"))
    }

    private fun sampleDetection() = LegacyMigrationDetectionDto(
        providers = listOf(
            MigrationProviderInfoDto("profile1", "anthropic", "claude-3", true, true, "anthropic"),
        ),
        mcpServers = emptyList(),
        customModes = emptyList(),
        sessions = emptyList(),
        defaultModel = null,
        settings = null,
        hasData = true,
    )

    private fun hasText(root: Container, text: String): Boolean {
        if (root is JLabel && root.text == text) return true
        if (root is AbstractButton && root.text == text) return true
        for (child in root.components) {
            if (child is JLabel && child.text == text) return true
            if (child is AbstractButton && child.text == text) return true
            if (child is Container && hasText(child, text)) return true
        }
        return false
    }

}
