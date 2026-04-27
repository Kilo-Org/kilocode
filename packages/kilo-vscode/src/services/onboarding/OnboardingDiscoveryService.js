var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import * as vscode from "vscode";
import { execSync } from "child_process";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { KiloLogger } from "../KiloLogger";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
var CACHE_KEY = "kilocode.discoveryResult";
var LOG_PREFIX = "[Onboarding]";
var FETCH_TIMEOUT_MS = 3000;
var PROBE_TIMEOUT_MS = 2000;
var OLLAMA_BASE = "http://localhost:11434";
var LMSTUDIO_BASE = "http://localhost:1234";
var HERMES_DEFAULT_ENDPOINT = "http://localhost:7001";
var SHIBA_DEFAULT_ENDPOINT = "http://localhost:7002";
var ZEROCLAW_DEFAULT_ENDPOINT = "http://localhost:7003";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
var svcLog = KiloLogger["for"]("OnboardingDiscovery");
function log(msg) {
    svcLog.info(msg);
}
function logError(msg, err) {
    svcLog.error(msg, err);
}
/**
 * Perform a fetch with an AbortController-based timeout.
 * Falls back gracefully when the global `fetch` is unavailable (older Node
 * runtimes bundled with some VS Code builds).
 */
function fetchWithTimeout(url, timeoutMs) {
    return __awaiter(this, void 0, void 0, function () {
        var controller, timer;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    controller = new AbortController();
                    timer = setTimeout(function () { return controller.abort(); }, timeoutMs);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, , 3, 4]);
                    return [4 /*yield*/, fetch(url, { signal: controller.signal })];
                case 2: return [2 /*return*/, _a.sent()];
                case 3:
                    clearTimeout(timer);
                    return [7 /*endfinally*/];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Extract a human-readable error message from an unknown error value.
 */
function errorMessage(err) {
    if (err instanceof Error) {
        return err.message;
    }
    if (typeof err === "string") {
        return err;
    }
    try {
        return JSON.stringify(err);
    }
    catch (_a) {
        return String(err);
    }
}
/**
 * Locate a `.kilo/<filename>` config file, preferring the current workspace
 * and falling back to the user's home directory. Returns the absolute path
 * if found, or `undefined` otherwise.
 */
function resolveKiloConfigPath(filename) {
    var candidates = [];
    var workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        candidates.push(path.join(workspaceFolders[0].uri.fsPath, ".kilo", filename));
    }
    candidates.push(path.join(os.homedir(), ".kilo", filename));
    for (var _i = 0, candidates_1 = candidates; _i < candidates_1.length; _i++) {
        var candidate = candidates_1[_i];
        try {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        catch (_a) {
            // Ignore individual access errors and keep probing.
        }
    }
    return undefined;
}
/**
 * Read and parse a JSON config file, returning `undefined` on any failure.
 */
function readJsonConfig(configPath) {
    try {
        var raw = fs.readFileSync(configPath, "utf-8");
        return JSON.parse(raw);
    }
    catch (err) {
        logError("Failed to parse config at " + configPath, err);
        return undefined;
    }
}
// ---------------------------------------------------------------------------
// Default (empty) result
// ---------------------------------------------------------------------------
function emptyResult() {
    var workspaceFolders = vscode.workspace.workspaceFolders;
    var defaultScope = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : "";
    return {
        providers: {
            ollama: { available: false, models: [] },
            lmstudio: { available: false, models: [], apiBase: LMSTUDIO_BASE }
        },
        gpu: { detected: false, name: "", vramGb: 0 },
        sshProfiles: [],
        speech: { browserVoicesAvailable: false, voiceCount: 0 },
        hardware: {
            cpuModel: "",
            cpuCores: 0,
            ramGb: 0,
            platform: os.platform(),
            arch: os.arch()
        },
        hermes: { configFound: false },
        shiba: { configFound: false },
        zeroClaw: { configFound: false, defaultScope: defaultScope },
        timestamp: Date.now()
    };
}
// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
var OnboardingDiscoveryService = /** @class */ (function () {
    function OnboardingDiscoveryService(context) {
        this.context = context;
        this.workspaceState = context.workspaceState;
        // Restore any previously cached result from workspace state.
        var persisted = this.workspaceState.get(CACHE_KEY);
        if (persisted) {
            this.cachedResult = persisted;
        }
    }
    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    /**
     * Run all discovery probes in parallel, cache the result, and return it.
     */
    OnboardingDiscoveryService.prototype.runFullDiscovery = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, providers, gpu, sshProfiles, hardware, hermes, shiba, zeroClaw, result, err_1;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        log("Starting full discovery...");
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 4, , 5]);
                        return [4 /*yield*/, Promise.all([
                                this.discoverLocalProviders(),
                                this.detectGPU(),
                                this.importSSHConfig(),
                                this.detectHardware(),
                                this.probeHermes(),
                                this.probeShiba(),
                                this.probeZeroClaw(),
                            ])];
                    case 2:
                        _a = _b.sent(), providers = _a[0], gpu = _a[1], sshProfiles = _a[2], hardware = _a[3], hermes = _a[4], shiba = _a[5], zeroClaw = _a[6];
                        result = {
                            providers: providers,
                            gpu: gpu,
                            sshProfiles: sshProfiles,
                            speech: {
                                // VS Code's webview can enumerate SpeechSynthesis voices on the
                                // frontend; from the extension host we simply flag availability.
                                browserVoicesAvailable: true,
                                voiceCount: 0
                            },
                            hardware: hardware,
                            hermes: hermes,
                            shiba: shiba,
                            zeroClaw: zeroClaw,
                            timestamp: Date.now()
                        };
                        this.cachedResult = result;
                        return [4 /*yield*/, this.workspaceState.update(CACHE_KEY, result)];
                    case 3:
                        _b.sent();
                        log("Full discovery complete.");
                        return [2 /*return*/, result];
                    case 4:
                        err_1 = _b.sent();
                        logError("Full discovery failed, returning defaults", err_1);
                        return [2 /*return*/, emptyResult()];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Re-run discovery (alias kept for readability at call-sites).
     */
    OnboardingDiscoveryService.prototype.refresh = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                log("Refreshing discovery results...");
                return [2 /*return*/, this.runFullDiscovery()];
            });
        });
    };
    /**
     * Return the most recent cached result, or `undefined` if discovery has
     * not yet run.
     */
    OnboardingDiscoveryService.prototype.getCachedResult = function () {
        return this.cachedResult;
    };
    OnboardingDiscoveryService.prototype.dispose = function () {
        log("Disposed.");
    };
    // -----------------------------------------------------------------------
    // Detectors (private)
    // -----------------------------------------------------------------------
    /**
     * Probe Ollama and LM Studio local endpoints.
     */
    OnboardingDiscoveryService.prototype.discoverLocalProviders = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, ollama, lmstudio;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, Promise.all([
                            this.probeOllama(),
                            this.probeLMStudio(),
                        ])];
                    case 1:
                        _a = _b.sent(), ollama = _a[0], lmstudio = _a[1];
                        return [2 /*return*/, { ollama: ollama, lmstudio: lmstudio }];
                }
            });
        });
    };
    OnboardingDiscoveryService.prototype.probeOllama = function () {
        return __awaiter(this, void 0, void 0, function () {
            var pingRes, version, body, json, _a, models, tagsRes, tagsBody, _i, _b, m, _c, _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        _e.trys.push([0, 12, , 13]);
                        return [4 /*yield*/, fetchWithTimeout(OLLAMA_BASE + "/", FETCH_TIMEOUT_MS)];
                    case 1:
                        pingRes = _e.sent();
                        if (!pingRes.ok) {
                            return [2 /*return*/, { available: false, models: [] }];
                        }
                        version = void 0;
                        _e.label = 2;
                    case 2:
                        _e.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, pingRes.text()
                            // Ollama returns a plain text string like "Ollama is running"
                            // but newer builds return JSON with a version field.
                        ];
                    case 3:
                        body = _e.sent();
                        // Ollama returns a plain text string like "Ollama is running"
                        // but newer builds return JSON with a version field.
                        if (body.startsWith("{")) {
                            json = JSON.parse(body);
                            version = json.version;
                        }
                        return [3 /*break*/, 5];
                    case 4:
                        _a = _e.sent();
                        return [3 /*break*/, 5];
                    case 5:
                        models = [];
                        _e.label = 6;
                    case 6:
                        _e.trys.push([6, 10, , 11]);
                        return [4 /*yield*/, fetchWithTimeout(OLLAMA_BASE + "/api/tags", FETCH_TIMEOUT_MS)];
                    case 7:
                        tagsRes = _e.sent();
                        if (!tagsRes.ok) return [3 /*break*/, 9];
                        return [4 /*yield*/, tagsRes.json()];
                    case 8:
                        tagsBody = (_e.sent());
                        if (Array.isArray(tagsBody.models)) {
                            for (_i = 0, _b = tagsBody.models; _i < _b.length; _i++) {
                                m = _b[_i];
                                if (m.name) {
                                    models.push(m.name);
                                }
                            }
                        }
                        _e.label = 9;
                    case 9: return [3 /*break*/, 11];
                    case 10:
                        _c = _e.sent();
                        return [3 /*break*/, 11];
                    case 11:
                        log("Ollama detected (" + models.length + " model(s))");
                        return [2 /*return*/, { available: true, models: models, version: version }];
                    case 12:
                        _d = _e.sent();
                        return [2 /*return*/, { available: false, models: [] }];
                    case 13: return [2 /*return*/];
                }
            });
        });
    };
    OnboardingDiscoveryService.prototype.probeLMStudio = function () {
        return __awaiter(this, void 0, void 0, function () {
            var base, pingRes, models, modelsRes, body, _i, _a, m, _b, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        base = {
                            available: false,
                            models: [],
                            apiBase: LMSTUDIO_BASE
                        };
                        _d.label = 1;
                    case 1:
                        _d.trys.push([1, 9, , 10]);
                        return [4 /*yield*/, fetchWithTimeout(LMSTUDIO_BASE + "/", FETCH_TIMEOUT_MS)];
                    case 2:
                        pingRes = _d.sent();
                        if (!pingRes.ok) {
                            return [2 /*return*/, base];
                        }
                        models = [];
                        _d.label = 3;
                    case 3:
                        _d.trys.push([3, 7, , 8]);
                        return [4 /*yield*/, fetchWithTimeout(LMSTUDIO_BASE + "/v1/models", FETCH_TIMEOUT_MS)];
                    case 4:
                        modelsRes = _d.sent();
                        if (!modelsRes.ok) return [3 /*break*/, 6];
                        return [4 /*yield*/, modelsRes.json()];
                    case 5:
                        body = (_d.sent());
                        if (Array.isArray(body.data)) {
                            for (_i = 0, _a = body.data; _i < _a.length; _i++) {
                                m = _a[_i];
                                if (m.id) {
                                    models.push(m.id);
                                }
                            }
                        }
                        _d.label = 6;
                    case 6: return [3 /*break*/, 8];
                    case 7:
                        _b = _d.sent();
                        return [3 /*break*/, 8];
                    case 8:
                        log("LM Studio detected (" + models.length + " model(s))");
                        return [2 /*return*/, { available: true, models: models, apiBase: LMSTUDIO_BASE }];
                    case 9:
                        _c = _d.sent();
                        return [2 /*return*/, base];
                    case 10: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Detect GPU information using platform-specific tooling.
     */
    OnboardingDiscoveryService.prototype.detectGPU = function () {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function () {
            var none, raw, parts, name_1, vramMb, driverVersion, raw;
            return __generator(this, function (_c) {
                none = { detected: false, name: "", vramGb: 0 };
                // Try nvidia-smi first (works on Linux, Windows with NVIDIA drivers).
                try {
                    raw = execSync("nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits", { timeout: 5000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
                    if (raw) {
                        parts = raw.split(",").map(function (s) { return s.trim(); });
                        name_1 = (_a = parts[0]) !== null && _a !== void 0 ? _a : "";
                        vramMb = parseFloat((_b = parts[1]) !== null && _b !== void 0 ? _b : "0");
                        driverVersion = parts[2];
                        log("GPU detected via nvidia-smi: " + name_1);
                        return [2 /*return*/, {
                                detected: true,
                                name: name_1,
                                vramGb: Math.round((vramMb / 1024) * 100) / 100,
                                driverVersion: driverVersion
                            }];
                    }
                }
                catch (_d) {
                    // nvidia-smi not available or failed.
                }
                // Windows fallback via PowerShell / CIM.
                if (os.platform() === "win32") {
                    try {
                        raw = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name"', { timeout: 5000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
                        if (raw) {
                            log("GPU detected via WMI: " + raw);
                            return [2 /*return*/, { detected: true, name: raw, vramGb: 0 }];
                        }
                    }
                    catch (_e) {
                        // PowerShell fallback failed.
                    }
                }
                return [2 /*return*/, none];
            });
        });
    };
    /**
     * Parse `~/.ssh/config` to extract host profiles.
     */
    OnboardingDiscoveryService.prototype.importSSHConfig = function () {
        return __awaiter(this, void 0, void 0, function () {
            var profiles, configPath, content, lines, current, _i, lines_1, rawLine, line, match, key, value;
            return __generator(this, function (_a) {
                profiles = [];
                try {
                    configPath = path.join(os.homedir(), ".ssh", "config");
                    if (!fs.existsSync(configPath)) {
                        return [2 /*return*/, profiles];
                    }
                    content = fs.readFileSync(configPath, "utf-8");
                    lines = content.split(/\r?\n/);
                    current = null;
                    for (_i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
                        rawLine = lines_1[_i];
                        line = rawLine.trim();
                        // Skip comments and blank lines.
                        if (!line || line.startsWith("#")) {
                            continue;
                        }
                        match = /^(\S+)\s+(.+)$/.exec(line);
                        if (!match) {
                            continue;
                        }
                        key = match[1].toLowerCase();
                        value = match[2].trim();
                        if (key === "host") {
                            // Flush previous host.
                            if (current) {
                                profiles.push(current);
                            }
                            // Skip wildcard patterns.
                            if (value.includes("*") || value.includes("?")) {
                                current = null;
                                continue;
                            }
                            current = {
                                name: value,
                                host: value,
                                port: 22,
                                user: os.userInfo().username
                            };
                        }
                        else if (current) {
                            switch (key) {
                                case "hostname":
                                    current.host = value;
                                    break;
                                case "port":
                                    current.port = parseInt(value, 10) || 22;
                                    break;
                                case "user":
                                    current.user = value;
                                    break;
                                case "identityfile":
                                    current.identityFile = value.replace(/^~/, os.homedir());
                                    break;
                                case "proxyjump":
                                    current.jumpHost = value;
                                    break;
                            }
                        }
                    }
                    // Flush the last parsed host.
                    if (current) {
                        profiles.push(current);
                    }
                    log("Imported " + profiles.length + " SSH profile(s)");
                }
                catch (err) {
                    logError("Failed to parse SSH config", err);
                }
                return [2 /*return*/, profiles];
            });
        });
    };
    /**
     * Detect basic hardware specs from Node's `os` module.
     */
    OnboardingDiscoveryService.prototype.detectHardware = function () {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function () {
            var cpus, result;
            return __generator(this, function (_c) {
                try {
                    cpus = os.cpus();
                    result = {
                        cpuModel: (_b = (_a = cpus[0]) === null || _a === void 0 ? void 0 : _a.model) !== null && _b !== void 0 ? _b : "unknown",
                        cpuCores: cpus.length,
                        ramGb: Math.round((os.totalmem() / Math.pow(1024, 3)) * 100) / 100,
                        platform: os.platform(),
                        arch: os.arch()
                    };
                    log("Hardware: " + result.cpuModel + ", " + result.cpuCores + " cores, " + result.ramGb + " GB RAM");
                    return [2 /*return*/, result];
                }
                catch (err) {
                    logError("Hardware detection failed", err);
                    return [2 /*return*/, {
                            cpuModel: "unknown",
                            cpuCores: 0,
                            ramGb: 0,
                            platform: os.platform(),
                            arch: os.arch()
                        }];
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Legacy Hermes detector. Kept as a thin wrapper over `probeHermes()` so
     * existing callers that only inspect `configFound` continue to work.
     */
    OnboardingDiscoveryService.prototype.detectHermes = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.probeHermes()];
            });
        });
    };
    /**
     * Deep-probe Hermes: locate the config file (workspace or home), resolve
     * the endpoint, hit `/health` with a 2s timeout, and report status.
     */
    OnboardingDiscoveryService.prototype.probeHermes = function () {
        return __awaiter(this, void 0, void 0, function () {
            var configPath, configFound, endpoint, parsed, res, error, version, body, json, _a, err_2, error;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        configPath = resolveKiloConfigPath("hermes.json");
                        configFound = false;
                        endpoint = HERMES_DEFAULT_ENDPOINT;
                        if (configPath) {
                            parsed = readJsonConfig(configPath);
                            configFound = true;
                            if ((parsed === null || parsed === void 0 ? void 0 : parsed.endpoint) && typeof parsed.endpoint === "string") {
                                endpoint = parsed.endpoint;
                            }
                            log("Hermes config found at " + configPath);
                        }
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 7, , 8]);
                        return [4 /*yield*/, fetchWithTimeout(endpoint + "/health", PROBE_TIMEOUT_MS)];
                    case 2:
                        res = _b.sent();
                        if (!res.ok) {
                            error = "Hermes /health returned HTTP " + res.status;
                            log(error);
                            return [2 /*return*/, { configFound: configFound, endpoint: endpoint, reachable: false, error: error }];
                        }
                        version = void 0;
                        _b.label = 3;
                    case 3:
                        _b.trys.push([3, 5, , 6]);
                        return [4 /*yield*/, res.text()];
                    case 4:
                        body = _b.sent();
                        if (body.startsWith("{")) {
                            json = JSON.parse(body);
                            version = typeof json.version === "string" ? json.version : undefined;
                        }
                        return [3 /*break*/, 6];
                    case 5:
                        _a = _b.sent();
                        return [3 /*break*/, 6];
                    case 6:
                        log("Hermes reachable at " + endpoint + (version ? " (v" + version + ")" : ""));
                        return [2 /*return*/, { configFound: configFound, endpoint: endpoint, reachable: true, version: version }];
                    case 7:
                        err_2 = _b.sent();
                        error = errorMessage(err_2);
                        logError("Hermes probe failed at " + endpoint, err_2);
                        return [2 /*return*/, { configFound: configFound, endpoint: endpoint, reachable: false, error: error }];
                    case 8: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Deep-probe Shiba: locate the config file, resolve endpoint, hit
     * `/health` with 2s timeout, and report reachable/connected agents.
     */
    OnboardingDiscoveryService.prototype.probeShiba = function () {
        var _a;
        return __awaiter(this, void 0, void 0, function () {
            var configPath, configFound, endpoint, parsed, res, error, connectedAgents, body, json, raw, _b, err_3, error;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        configPath = resolveKiloConfigPath("shiba.json");
                        configFound = false;
                        endpoint = SHIBA_DEFAULT_ENDPOINT;
                        if (configPath) {
                            parsed = readJsonConfig(configPath);
                            configFound = true;
                            if ((parsed === null || parsed === void 0 ? void 0 : parsed.endpoint) && typeof parsed.endpoint === "string") {
                                endpoint = parsed.endpoint;
                            }
                            log("Shiba config found at " + configPath);
                        }
                        _c.label = 1;
                    case 1:
                        _c.trys.push([1, 7, , 8]);
                        return [4 /*yield*/, fetchWithTimeout(endpoint + "/health", PROBE_TIMEOUT_MS)];
                    case 2:
                        res = _c.sent();
                        if (!res.ok) {
                            error = "Shiba /health returned HTTP " + res.status;
                            log(error);
                            return [2 /*return*/, { configFound: configFound, endpoint: endpoint, reachable: false, error: error }];
                        }
                        connectedAgents = void 0;
                        _c.label = 3;
                    case 3:
                        _c.trys.push([3, 5, , 6]);
                        return [4 /*yield*/, res.text()];
                    case 4:
                        body = _c.sent();
                        if (body.startsWith("{")) {
                            json = JSON.parse(body);
                            raw = (_a = json.connectedAgents) !== null && _a !== void 0 ? _a : json.agents;
                            if (Array.isArray(raw)) {
                                connectedAgents = raw
                                    .map(function (entry) {
                                    if (typeof entry === "string") {
                                        return entry;
                                    }
                                    if (entry && typeof entry === "object") {
                                        var rec = entry;
                                        if (typeof rec.id === "string")
                                            return rec.id;
                                        if (typeof rec.name === "string")
                                            return rec.name;
                                    }
                                    return undefined;
                                })
                                    .filter(function (v) { return typeof v === "string"; });
                            }
                        }
                        return [3 /*break*/, 6];
                    case 5:
                        _b = _c.sent();
                        return [3 /*break*/, 6];
                    case 6:
                        log("Shiba reachable at " + endpoint +
                            (connectedAgents ? " (" + connectedAgents.length + " agent(s))" : ""));
                        return [2 /*return*/, { configFound: configFound, endpoint: endpoint, reachable: true, connectedAgents: connectedAgents }];
                    case 7:
                        err_3 = _c.sent();
                        error = errorMessage(err_3);
                        logError("Shiba probe failed at " + endpoint, err_3);
                        return [2 /*return*/, { configFound: configFound, endpoint: endpoint, reachable: false, error: error }];
                    case 8: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Deep-probe ZeroClaw: locate the config file, resolve endpoint, hit
     * `/health` with 2s timeout, and attach the current workspace folder as
     * the default scope.
     */
    OnboardingDiscoveryService.prototype.probeZeroClaw = function () {
        return __awaiter(this, void 0, void 0, function () {
            var workspaceFolders, defaultScope, configPath, configFound, endpoint, parsed, res, error, err_4, error;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        workspaceFolders = vscode.workspace.workspaceFolders;
                        defaultScope = workspaceFolders && workspaceFolders.length > 0
                            ? workspaceFolders[0].uri.fsPath
                            : "";
                        configPath = resolveKiloConfigPath("zeroclaw.json");
                        configFound = false;
                        endpoint = ZEROCLAW_DEFAULT_ENDPOINT;
                        if (configPath) {
                            parsed = readJsonConfig(configPath);
                            configFound = true;
                            if ((parsed === null || parsed === void 0 ? void 0 : parsed.endpoint) && typeof parsed.endpoint === "string") {
                                endpoint = parsed.endpoint;
                            }
                            log("ZeroClaw config found at " + configPath);
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, fetchWithTimeout(endpoint + "/health", PROBE_TIMEOUT_MS)];
                    case 2:
                        res = _a.sent();
                        if (!res.ok) {
                            error = "ZeroClaw /health returned HTTP " + res.status;
                            log(error);
                            return [2 /*return*/, { configFound: configFound, endpoint: endpoint, reachable: false, defaultScope: defaultScope, error: error }];
                        }
                        log("ZeroClaw reachable at " + endpoint);
                        return [2 /*return*/, { configFound: configFound, endpoint: endpoint, reachable: true, defaultScope: defaultScope }];
                    case 3:
                        err_4 = _a.sent();
                        error = errorMessage(err_4);
                        logError("ZeroClaw probe failed at " + endpoint, err_4);
                        return [2 /*return*/, { configFound: configFound, endpoint: endpoint, reachable: false, defaultScope: defaultScope, error: error }];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    return OnboardingDiscoveryService;
}());
export { OnboardingDiscoveryService };
//# sourceMappingURL=OnboardingDiscoveryService.js.map