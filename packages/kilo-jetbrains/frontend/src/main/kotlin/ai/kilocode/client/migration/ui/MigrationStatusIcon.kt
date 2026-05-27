package ai.kilocode.client.migration.ui

import ai.kilocode.rpc.dto.MigrationItemProgressStatusDto
import com.intellij.icons.AllIcons
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.components.JBLabel
import javax.swing.Icon

/** Shows an animated spinner (migrating), success, warning, or error icon. */
class MigrationStatusIcon : JBLabel() {

    fun update(status: MigrationItemProgressStatusDto) {
        icon = iconFor(status)
    }

    private fun iconFor(status: MigrationItemProgressStatusDto): Icon = when (status) {
        MigrationItemProgressStatusDto.migrating -> AnimatedIcon.Default()
        MigrationItemProgressStatusDto.success -> AllIcons.General.InspectionsOK
        MigrationItemProgressStatusDto.warning -> AllIcons.General.Warning
        MigrationItemProgressStatusDto.error -> AllIcons.General.Error
    }
}
