package ai.kilocode.client.migration.ui

import ai.kilocode.client.migration.FakeMigrationUiController
import ai.kilocode.client.migration.MigrationItemUiProgress
import ai.kilocode.client.migration.MigrationUiPhase
import ai.kilocode.client.migration.MigrationUiState
import ai.kilocode.client.onboarding.OnboardingRunState
import ai.kilocode.rpc.dto.LegacyMigrationDetectionDto
import ai.kilocode.rpc.dto.LegacyMigrationResultItemDto
import ai.kilocode.rpc.dto.MigrationItemCategoryDto
import ai.kilocode.rpc.dto.MigrationItemProgressStatusDto
import ai.kilocode.rpc.dto.MigrationItemStatusDto
import ai.kilocode.rpc.dto.MigrationProviderInfoDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking

@Suppress("UnstableApiUsage")
class MigrationStepViewTest : BasePlatformTestCase() {

    private lateinit var controller: FakeMigrationUiController
    private lateinit var view: MigrationStepView

    override fun setUp() {
        super.setUp()
        controller = FakeMigrationUiController()
        view = MigrationStepView(controller)
    }

    override fun tearDown() {
        try {
            view.dispose()
        } finally {
            super.tearDown()
        }
    }

    private fun settle() = runBlocking {
        repeat(3) {
            delay(50)
            UIUtil.dispatchAllInvocationEvents()
        }
    }

    private fun find(root: java.awt.Container, cls: Class<MigrationItemRow>): MigrationItemRow? {
        if (cls.isInstance(root)) return cls.cast(root)
        for (child in root.components) {
            if (cls.isInstance(child)) return cls.cast(child)
            if (child is java.awt.Container) {
                val item = find(child, cls)
                if (item != null) return item
            }
        }
        return null
    }

    fun `test keep legacy settings default checked`() {
        controller._state.value = MigrationUiState.Needed(detection = sampleDetection())
        settle()
        val box = findCheckBox(view) ?: error("missing keep-legacy checkbox")
        assertTrue(box.isSelected)
    }

    fun `test ready is false until a row is selected`() {
        controller._state.value = MigrationUiState.Needed(
            detection = sampleDetection().copy(providers = emptyList()),
        )
        settle()
        // No visible rows selected (provider row hidden since no supported providers).
        assertFalse(view.ready.value)
    }

    fun `test ready is true when a visible row is selected by default`() {
        controller._state.value = MigrationUiState.Needed(detection = sampleDetection())
        settle()
        assertTrue(view.ready.value)
    }

    fun `test phase mapping selecting migrating done`() {
        val det = sampleDetection()
        controller._state.value = MigrationUiState.Needed(detection = det)
        settle()
        assertEquals(OnboardingRunState.Idle, view.run.value)

        controller._state.value = MigrationUiState.Needed(
            detection = det,
            phase = MigrationUiPhase.migrating,
            running = true,
            progress = listOf(MigrationItemUiProgress("profile1", MigrationItemCategoryDto.provider, MigrationItemProgressStatusDto.migrating)),
        )
        settle()
        assertEquals(OnboardingRunState.Running, view.run.value)

        controller._state.value = MigrationUiState.Needed(
            detection = det,
            phase = MigrationUiPhase.done,
            progress = listOf(MigrationItemUiProgress("profile1", MigrationItemCategoryDto.provider, MigrationItemProgressStatusDto.success)),
        )
        settle()
        assertEquals(OnboardingRunState.Done, view.run.value)
    }

    fun `test phase mapping error carries message`() {
        val det = sampleDetection()
        controller._state.value = MigrationUiState.Needed(detection = det)
        settle()
        controller._state.value = MigrationUiState.Needed(
            detection = det,
            phase = MigrationUiPhase.error,
            results = listOf(LegacyMigrationResultItemDto("Migration", MigrationItemCategoryDto.settings, MigrationItemStatusDto.error, "bad key")),
        )
        settle()
        val run = view.run.value
        assertTrue(run is OnboardingRunState.Failed)
        assertEquals("bad key", (run as OnboardingRunState.Failed).message)
    }

    fun `test row identity and height stable across phase changes`() {
        val det = sampleDetection()
        controller._state.value = MigrationUiState.Needed(detection = det)
        settle()

        val row = find(view, MigrationItemRow::class.java) ?: error("missing row")
        val count = row.componentCount
        val height = row.preferredSize.height

        controller._state.value = MigrationUiState.Needed(
            detection = det,
            phase = MigrationUiPhase.migrating,
            running = true,
            progress = listOf(MigrationItemUiProgress("profile1", MigrationItemCategoryDto.provider, MigrationItemProgressStatusDto.migrating)),
        )
        settle()

        val row2 = find(view, MigrationItemRow::class.java)
        assertSame(row, row2)
        assertEquals(count, row2!!.componentCount)
        assertEquals(height, row2.preferredSize.height)
    }

    fun `test start delegates to controller with current selections`() {
        controller._state.value = MigrationUiState.Needed(detection = sampleDetection())
        settle()
        view.start()
        assertEquals(1, controller.starts.size)
        assertEquals(listOf("profile1"), controller.starts.single().providers)
    }

    fun `test done delegates to controller finish`() {
        controller._state.value = MigrationUiState.Needed(detection = sampleDetection())
        settle()
        view.done()
        assertEquals(1, controller.finishes.size)
    }

    private fun findCheckBox(root: java.awt.Container): com.intellij.ui.components.JBCheckBox? {
        for (child in root.components) {
            if (child is com.intellij.ui.components.JBCheckBox) return child
            if (child is java.awt.Container) {
                val found = findCheckBox(child)
                if (found != null) return found
            }
        }
        return null
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
}
