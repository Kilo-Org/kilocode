// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "kilo-voice-sidecar",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "kilo-voice-sidecar",
            path: "Sources/kilo-voice-sidecar",
            exclude: ["Info.plist"],
            linkerSettings: [
                // Embed an Info.plist into the binary so macOS sees the
                // microphone / speech-recognition usage strings. Without this a
                // SwiftPM CLI has no usage descriptions and the TCC permission
                // request never resolves (the mic silently fails).
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", "Sources/kilo-voice-sidecar/Info.plist",
                ])
            ]
        )
    ]
)
