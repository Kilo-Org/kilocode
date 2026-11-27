package ai.kilocode.backend.cli

import com.intellij.openapi.util.SystemInfo
import com.intellij.util.system.CpuArch

internal object KiloCliPlatform {
    fun current(): String {
        val os = when {
            SystemInfo.isMac -> "darwin"
            SystemInfo.isLinux -> "linux"
            SystemInfo.isWindows -> "windows"
            else -> error("No Kilo CLI for this operating system")
        }
        val arch = when (CpuArch.CURRENT) {
            CpuArch.ARM64 -> "arm64"
            CpuArch.X86_64 -> "x64"
            else -> error("No Kilo CLI for ${CpuArch.CURRENT}")
        }
        return "$os-$arch"
    }
}
