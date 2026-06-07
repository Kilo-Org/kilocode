// Kilo Design Mode — local voice sidecar (Apple Speech).
//
// Speaks the Voice Helper Protocol: newline-delimited JSON on stdout, commands
// on stdin. Default mode is continuous always-on listening with automatic
// end-of-utterance: the mic stays open, partial transcripts stream out, and a
// finalized `turn` is emitted after a short silence window — no key toggling.
//
// Events out (stdout):  {"type":"state","value":"listening"}
//                       {"type":"partial","text":"..."}
//                       {"type":"turn","text":"...","latencyMs":N}
//                       {"type":"level","peak":0.0..1.0}
//                       {"type":"error","message":"..."}
// Commands in (stdin):  {"type":"reset"} {"type":"stop"} {"type":"shutdown"}
//                       {"type":"set-activation","value":"continuous"|"push-to-talk"}
//
// Test modes (no mic): --turn "text"  or  --script "a|b|c"

import Foundation
import AVFoundation
import Speech

// MARK: - JSONL IO

let outQueue = DispatchQueue(label: "kilo.voice.out")

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
    outQueue.sync {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0a]))
    }
}

func emitState(_ value: String) { emit(["type": "state", "value": value]) }
func emitError(_ message: String) { emit(["type": "error", "message": message]) }

// Diagnostic logging to stderr (the parent logs this; it never pollutes the
// JSONL on stdout).
func logErr(_ message: String) {
    FileHandle.standardError.write(Data(("[voice] " + message + "\n").utf8))
}

// MARK: - Argument parsing

struct Args {
    var activation = "continuous"
    var silenceMs = 1100
    var script: [String] = []
    var single: String?
}

func parseArgs() -> Args {
    var args = Args()
    var it = CommandLine.arguments.dropFirst().makeIterator()
    while let arg = it.next() {
        switch arg {
        case "--activation": if let v = it.next() { args.activation = v }
        case "--silence-ms": if let v = it.next(), let n = Int(v) { args.silenceMs = n }
        case "--script": if let v = it.next() { args.script = v.split(separator: "|").map { String($0).trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } }
        case "--turn": args.single = it.next()
        default: break
        }
    }
    return args
}

let args = parseArgs()

// MARK: - Scripted / single-turn test modes (no microphone)

func runScript(_ turns: [String]) {
    emitState("listening")
    for text in turns {
        Thread.sleep(forTimeInterval: 0.4)
        emitState("processing")
        emit(["type": "turn", "text": text])
        emitState("listening")
    }
    Thread.sleep(forTimeInterval: 0.1)
    exit(0)
}

if let single = args.single {
    runScript([single])
}
if !args.script.isEmpty {
    runScript(args.script)
}

// MARK: - Live microphone recognition

final class Sidecar {
    // Domain phrases to prime the recognizer with (improves accuracy for the
    // words you actually say when steering a design).
    static let designVocabulary = [
        "brand", "brand color", "accent", "accent color", "primary color",
        "hero", "hero title", "headline", "subtitle", "tagline",
        "background", "background color", "foreground", "text color",
        "navbar", "nav", "header", "footer", "button", "buttons", "call to action",
        "card", "cards", "grid", "columns", "two columns", "three columns",
        "padding", "margin", "spacing", "gap", "border", "border radius", "rounded corners",
        "font", "font size", "bold", "italic", "uppercase", "center", "centered", "align",
        "gradient", "shadow", "drop shadow", "dark mode", "light mode", "contrast",
        "bigger", "smaller", "wider", "narrower", "taller",
    ]

    private let engine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer()
    private let lock = DispatchQueue(label: "kilo.voice.state")
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var current = ""
    private var lastChange = Date()
    private var utteranceStart = Date()
    private var lastLevelEmit = Date(timeIntervalSince1970: 0)
    private var listening = false
    private var settled = false
    private var activation: String
    private let silence: TimeInterval
    private var timer: DispatchSourceTimer?
    private var permTimer: DispatchSourceTimer?

    init(activation: String, silenceMs: Int) {
        self.activation = activation
        self.silence = Double(silenceMs) / 1000.0
    }

    private func fault(_ message: String) {
        lock.async {
            if self.settled { return }
            self.settled = true
        }
        emitError(message)
        emitState("standby")
    }

    func start() {
        emitState("requesting-permission")
        let pre = SFSpeechRecognizer.authorizationStatus()
        logErr("pre-check speech auth status = \(pre.rawValue) (0=notDetermined 1=denied 2=restricted 3=authorized)")
        logErr("requesting speech-recognition authorization")

        // Watchdog: if the permission prompt can't appear (e.g. launched from a
        // host with no GUI session, or odd TCC attribution), requestAuthorization
        // never calls back. Surface that instead of hanging forever.
        let watchdog = DispatchSource.makeTimerSource(queue: lock)
        watchdog.schedule(deadline: .now() + 6)
        watchdog.setEventHandler { [weak self] in
            guard let self = self else { return }
            if self.settled || self.listening { return }
            self.fault("timed out waiting for microphone/speech permission. Grant your terminal app Microphone AND Speech Recognition in System Settings › Privacy & Security, then retry. (Tip: run the sidecar binary directly once to trigger the prompts.)")
        }
        watchdog.resume()
        self.permTimer = watchdog

        SFSpeechRecognizer.requestAuthorization { status in
            logErr("speech auth status = \(status.rawValue) (0=notDetermined 1=denied 2=restricted 3=authorized)")
            guard status == .authorized else {
                self.fault("speech recognition not authorized — enable it for your terminal in System Settings › Privacy & Security › Speech Recognition")
                return
            }
            // Starting AVAudioEngine triggers the microphone TCC prompt/attribution
            // on macOS; an explicit AVCaptureDevice request is unnecessary and can
            // hang for a non-bundled CLI.
            self.requestMic { granted in
                logErr("microphone access granted = \(granted)")
                guard granted else {
                    self.fault("microphone access denied — grant your terminal Microphone permission in System Settings › Privacy & Security › Microphone")
                    return
                }
                self.beginAudio()
            }
        }
    }

    private func requestMic(_ done: @escaping (Bool) -> Void) {
        if #available(macOS 14.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted: done(true)
            case .denied: done(false)
            default: AVAudioApplication.requestRecordPermission(completionHandler: done)
            }
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: done(true)
        case .denied, .restricted: done(false)
        default: AVCaptureDevice.requestAccess(for: .audio, completionHandler: done)
        }
    }

    private func beginAudio() {
        guard let recognizer = recognizer, recognizer.isAvailable else {
            fault("speech recognizer unavailable for this locale")
            return
        }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        logErr("input format: \(format.sampleRate)Hz, \(format.channelCount)ch")
        if format.sampleRate == 0 || format.channelCount == 0 {
            fault("no audio input device available (input format is empty)")
            return
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self = self else { return }
            self.lock.async { self.request?.append(buffer) }
            self.reportLevel(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            fault("failed to start audio engine: \(error.localizedDescription)")
            return
        }
        logErr("recognizer locale=\(recognizer.locale.identifier) onDevice=\(recognizer.supportsOnDeviceRecognition)")
        startSegment()
        startTimer()
        lock.async {
            self.listening = true
            self.settled = true
        }
        logErr("audio engine started; listening")
        emitState("listening")
    }

    // Begin a fresh recognition request for the next utterance.
    private func startSegment() {
        lock.async {
            self.task?.cancel()
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            // Bias recognition toward design vocabulary so words like "brand" and
            // "hero" stop becoming "brown"/"heroic". taskHint=.dictation tunes the
            // model for free-form spoken instructions.
            req.taskHint = .dictation
            req.contextualStrings = Sidecar.designVocabulary
            self.request = req
            self.current = ""
            self.lastChange = Date()
            self.utteranceStart = Date()
            guard let recognizer = self.recognizer else { return }
            self.task = recognizer.recognitionTask(with: req) { [weak self] result, error in
                guard let self = self else { return }
                if let result = result {
                    let text = result.bestTranscription.formattedString
                    logErr("recognition result: '\(text)' final=\(result.isFinal)")
                    self.lock.async {
                        if text != self.current {
                            self.current = text
                            self.lastChange = Date()
                            emit(["type": "partial", "text": text])
                        }
                    }
                }
                if let error = error {
                    logErr("recognition error: \(error.localizedDescription)")
                }
            }
            logErr("recognition segment started")
        }
    }

    // Poll for end-of-utterance: text present and unchanged for the silence window.
    private func startTimer() {
        let t = DispatchSource.makeTimerSource(queue: lock)
        t.schedule(deadline: .now() + 0.2, repeating: 0.2)
        t.setEventHandler { [weak self] in
            guard let self = self else { return }
            guard self.listening else { return }
            let text = self.current.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty && Date().timeIntervalSince(self.lastChange) >= self.silence {
                self.finalize(text)
            }
        }
        timer = t
        t.resume()
    }

    private func finalize(_ text: String) {
        let latency = Int(Date().timeIntervalSince(utteranceStart) * 1000)
        emitState("processing")
        emit(["type": "turn", "text": text, "latencyMs": latency])
        emitState("listening")
        // Roll into a new segment without stopping the mic.
        request?.endAudio()
        startSegment()
    }

    private func reportLevel(_ buffer: AVAudioPCMBuffer) {
        guard let channel = buffer.floatChannelData?[0] else { return }
        let frames = Int(buffer.frameLength)
        if frames == 0 { return }
        var sum: Float = 0
        for i in 0..<frames { sum += channel[i] * channel[i] }
        let rms = (sum / Float(frames)).squareRoot()
        let peak = min(1.0, Double(rms) * 6.0)
        let now = Date()
        if now.timeIntervalSince(lastLevelEmit) > 0.1 {
            lastLevelEmit = now
            emit(["type": "level", "peak": peak])
        }
    }

    func reset() {
        lock.async {
            self.current = ""
            self.lastChange = Date()
        }
        startSegment()
        emit(["type": "partial", "text": ""])
        emitState("listening")
    }

    func stop() {
        lock.async { self.listening = false }
        emitState("standby")
    }

    func setActivation(_ value: String) {
        lock.async { self.activation = value }
    }

    func shutdown() {
        timer?.cancel()
        task?.cancel()
        if engine.isRunning {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        exit(0)
    }
}

let sidecar = Sidecar(activation: args.activation, silenceMs: args.silenceMs)

// MARK: - stdin command loop

func handleCommand(_ line: String) {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let type = obj["type"] as? String else { return }
    switch type {
    case "reset": sidecar.reset()
    case "stop": sidecar.stop()
    case "shutdown": sidecar.shutdown()
    case "set-activation": if let v = obj["value"] as? String { sidecar.setActivation(v) }
    default: break
    }
}

let stdinQueue = DispatchQueue(label: "kilo.voice.in")
var stdinBuffer = Data()
FileHandle.standardInput.readabilityHandler = { handle in
    let chunk = handle.availableData
    if chunk.isEmpty { return }
    stdinQueue.async {
        stdinBuffer.append(chunk)
        while let nl = stdinBuffer.firstIndex(of: 0x0a) {
            let lineData = stdinBuffer.subdata(in: stdinBuffer.startIndex..<nl)
            stdinBuffer.removeSubrange(stdinBuffer.startIndex...nl)
            if let line = String(data: lineData, encoding: .utf8) { handleCommand(line) }
        }
    }
}

sidecar.start()
dispatchMain()
