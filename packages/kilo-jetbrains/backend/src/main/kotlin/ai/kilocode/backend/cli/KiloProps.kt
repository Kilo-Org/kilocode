package ai.kilocode.backend.cli

import java.util.Base64
import java.util.Properties
import java.net.URL

internal data class CliPin(val version: String, val platform: String, val integrity: String, val retentionVersion: String? = null) {
    init {
        require(version.matches(Regex("0\\.0\\.0-v2-[0-9]+"))) { "Expected an exact Kilo v2 CLI release pin" }
        require(platform.matches(Regex("(darwin|linux|windows)-(x64|arm64)"))) { "Unsupported CLI platform: $platform" }
        require(integrity.startsWith("sha512-") && Base64.getDecoder().decode(integrity.removePrefix("sha512-")).size == 64) {
            "Invalid CLI checksum for $platform"
        }
    }

    val executable = if (platform.startsWith("windows-")) "kilo2.exe" else "kilo2"
    val tarball = "https://registry.npmjs.org/@kilocode/cli-$platform/-/cli-$platform-$version.tgz"
    val bundled: URL? get() = CliPin::class.java.getResource("/kilo-v2-cli/$platform.tgz")
}

internal object KiloProps {
    val pin by lazy {
        val platform = KiloCliPlatform.current()
        val props = Properties().apply {
            requireNotNull(KiloProps::class.java.getResourceAsStream("/kilo-v2-cli.properties")) {
                "Missing Kilo v2 CLI release pin"
            }.use(::load)
        }
        val version = props.getProperty("cli.version")
        CliPin(version, platform, props.getProperty("cli.integrity.$platform"),
            props.getProperty("cli.retention.verified-version")?.takeIf { it == version })
    }
}
