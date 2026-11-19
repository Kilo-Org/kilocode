package ai.kilocode.client.test

import com.intellij.ide.CopyProvider
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.DataMap
import com.intellij.openapi.actionSystem.DataProvider
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.DataSnapshotProvider
import com.intellij.openapi.actionSystem.PlatformDataKeys
import com.intellij.openapi.actionSystem.UiDataProvider

@Suppress("UnstableApiUsage")
open class CopyProviderSink : DataSink {
    var copy: CopyProvider? = null

    override fun <T : Any> set(key: DataKey<T>, data: T?) {
        if (key == PlatformDataKeys.COPY_PROVIDER) copy = data as? CopyProvider
    }

    override fun <T : Any> setNull(key: DataKey<T>) {}

    override fun <T : Any> lazyNull(key: DataKey<T>) {}

    override fun <T : Any> lazyValue(key: DataKey<T>, data: (DataMap) -> T?) {}

    override fun uiDataSnapshot(provider: UiDataProvider) = provider.uiDataSnapshot(this)
    override fun dataSnapshot(provider: DataSnapshotProvider) = provider.dataSnapshot(this)
    override fun uiDataSnapshot(provider: DataProvider) {}
}
