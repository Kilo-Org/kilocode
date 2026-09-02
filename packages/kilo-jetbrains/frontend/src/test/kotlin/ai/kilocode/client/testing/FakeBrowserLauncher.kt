package ai.kilocode.client.testing

import com.intellij.ide.browsers.BrowserLauncher
import com.intellij.ide.browsers.WebBrowser
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import java.nio.file.Path

class FakeBrowserLauncher : BrowserLauncher() {
    val urls = mutableListOf<String>()
    val files = mutableListOf<Path>()

    override fun open(url: String) {
        urls.add(url)
    }

    @Suppress("DEPRECATION")
    override fun browse(file: java.io.File) {
        files.add(file.toPath())
    }

    override fun browse(file: Path) {
        files.add(file)
    }

    override fun browse(url: String, browser: WebBrowser?, project: Project?) {
        urls.add(url)
    }
}

fun BasePlatformTestCase.installBrowser(): FakeBrowserLauncher {
    val fake = FakeBrowserLauncher()
    ApplicationManager.getApplication().replaceService(BrowserLauncher::class.java, fake, testRootDisposable)
    return fake
}
