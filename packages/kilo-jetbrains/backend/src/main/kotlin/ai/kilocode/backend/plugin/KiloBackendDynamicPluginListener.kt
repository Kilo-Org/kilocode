package ai.kilocode.backend.plugin

import ai.kilocode.KiloPlugin
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.cli.KiloBackendHttpClients
import ai.kilocode.log.KiloLog
import com.intellij.ide.plugins.DynamicPluginListener
import com.intellij.ide.plugins.IdeaPluginDescriptor
import com.intellij.openapi.components.service

class KiloBackendDynamicPluginListener : DynamicPluginListener {
    private val log = KiloLog.create(KiloBackendDynamicPluginListener::class.java)

    override fun beforePluginUnload(pluginDescriptor: IdeaPluginDescriptor, isUpdate: Boolean) {
        if (pluginDescriptor.pluginId != KiloPlugin.id) return
        log.info("Shutting down Kilo backend for plugin unload (isUpdate=$isUpdate)")
        service<KiloBackendAppService>().shutdownForUnload()
        // Kill bundled-OkHttp daemon threads (dispatcher, connection pool, and the process-global
        // shared TaskRunner) so the plugin classloader is collectible within IntelliJ's short unload
        // GC window. Only done here, on real unload — never on transient service dispose.
        KiloBackendHttpClients.shutdownAll()
        log.info("Kilo backend unload teardown finished (isUpdate=$isUpdate)")
    }
}
