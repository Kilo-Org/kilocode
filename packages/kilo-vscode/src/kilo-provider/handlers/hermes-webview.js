/**
 * hermes-webview.ts
 *
 * Bridges webview messages from HermesTab.tsx → HermesStatusService / HermesClient / HermesPipeline.
 *
 * Message types handled:
 *   requestHermesStatus      → query current config + reachability, push hermesStatusUpdate
 *   hermesToggle             → toggle enabled/disabled
 *   hermesTestConnection     → ping /health, push hermesStatusUpdate
 *   hermesSetApiKey          → store key in SecretStorage
 *   hermesClearApiKey        → clear key from SecretStorage
 *   hermesUpdateConfig       → update a single config value (baseUrl | approvalMode)
 *   hermesSubmitTask         → submit a task via HermesPipeline
 *   requestHermesTasks       → fetch active tasks, push hermesTasksUpdate
 *   hermesAgentAssist        → run full settings audit via SettingsAgentAPI
 */
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
import { saveKey, clearKey, keySource } from "../../services/hermes/secrets";
import { HERMES_CFG_SECTION } from "../../services/hermes/types";
function pushStatus(ctx) {
    return __awaiter(this, void 0, void 0, function () {
        var cfg, src, reachable, latency_ms, version, error, res, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    cfg = ctx.status.getConfig();
                    return [4 /*yield*/, keySource(ctx.extensionContext)];
                case 1:
                    src = _a.sent();
                    reachable = false;
                    latency_ms = 0;
                    if (!cfg.enabled) return [3 /*break*/, 5];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, ctx.client.health(5000)];
                case 3:
                    res = _a.sent();
                    reachable = res.bridge_reachable && res.ok;
                    latency_ms = res.latency_ms;
                    version = res.version;
                    error = res.error;
                    return [3 /*break*/, 5];
                case 4:
                    e_1 = _a.sent();
                    error = e_1 instanceof Error ? e_1.message : String(e_1);
                    return [3 /*break*/, 5];
                case 5:
                    ctx.postMessage({
                        type: "hermesStatusUpdate",
                        status: {
                            enabled: cfg.enabled,
                            baseUrl: cfg.baseUrl,
                            approvalMode: cfg.approvalMode,
                            workspaceScopeOnly: cfg.workspaceScopeOnly,
                            reachable: reachable,
                            latency_ms: latency_ms,
                            version: version,
                            keySource: src,
                            error: error
                        }
                    });
                    return [2 /*return*/];
            }
        });
    });
}
function pushTasks(ctx) {
    return __awaiter(this, void 0, void 0, function () {
        var tasks, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, ctx.client.listTasks()];
                case 1:
                    tasks = _b.sent();
                    ctx.postMessage({ type: "hermesTasksUpdate", tasks: tasks });
                    return [3 /*break*/, 3];
                case 2:
                    _a = _b.sent();
                    ctx.postMessage({ type: "hermesTasksUpdate", tasks: [] });
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
// eslint-disable-next-line complexity
export function handleHermesWebviewMessage(msg, ctx) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function () {
        var _c, key, key, value, cfg, handle, e_2, result, suggestions, e_3;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    _c = msg.type;
                    switch (_c) {
                        case "requestHermesStatus": return [3 /*break*/, 1];
                        case "hermesToggle": return [3 /*break*/, 3];
                        case "hermesTestConnection": return [3 /*break*/, 6];
                        case "hermesSetApiKey": return [3 /*break*/, 9];
                        case "hermesClearApiKey": return [3 /*break*/, 14];
                        case "hermesUpdateConfig": return [3 /*break*/, 18];
                        case "hermesSubmitTask": return [3 /*break*/, 23];
                        case "requestHermesTasks": return [3 /*break*/, 27];
                        case "hermesAgentAssist": return [3 /*break*/, 29];
                    }
                    return [3 /*break*/, 34];
                case 1: return [4 /*yield*/, pushStatus(ctx)];
                case 2:
                    _d.sent();
                    return [2 /*return*/, true];
                case 3: return [4 /*yield*/, ctx.status.toggle()];
                case 4:
                    _d.sent();
                    return [4 /*yield*/, pushStatus(ctx)];
                case 5:
                    _d.sent();
                    return [2 /*return*/, true];
                case 6: return [4 /*yield*/, ctx.status.refresh()];
                case 7:
                    _d.sent();
                    return [4 /*yield*/, pushStatus(ctx)];
                case 8:
                    _d.sent();
                    return [2 /*return*/, true];
                case 9:
                    key = (_a = msg.key) === null || _a === void 0 ? void 0 : _a.trim();
                    if (!key) return [3 /*break*/, 12];
                    return [4 /*yield*/, saveKey(ctx.extensionContext, key)];
                case 10:
                    _d.sent();
                    return [4 /*yield*/, ctx.status.refresh()];
                case 11:
                    _d.sent();
                    _d.label = 12;
                case 12: return [4 /*yield*/, pushStatus(ctx)];
                case 13:
                    _d.sent();
                    return [2 /*return*/, true];
                case 14: return [4 /*yield*/, clearKey(ctx.extensionContext)];
                case 15:
                    _d.sent();
                    return [4 /*yield*/, ctx.status.refresh()];
                case 16:
                    _d.sent();
                    return [4 /*yield*/, pushStatus(ctx)];
                case 17:
                    _d.sent();
                    return [2 /*return*/, true];
                case 18:
                    key = msg.key;
                    value = msg.value;
                    if (!(key === "baseUrl" || key === "approvalMode")) return [3 /*break*/, 21];
                    cfg = vscode.workspace.getConfiguration(HERMES_CFG_SECTION);
                    return [4 /*yield*/, cfg.update(key, value, vscode.ConfigurationTarget.Global)];
                case 19:
                    _d.sent();
                    return [4 /*yield*/, ctx.status.refresh()];
                case 20:
                    _d.sent();
                    _d.label = 21;
                case 21: return [4 /*yield*/, pushStatus(ctx)];
                case 22:
                    _d.sent();
                    return [2 /*return*/, true];
                case 23:
                    _d.trys.push([23, 25, , 26]);
                    return [4 /*yield*/, ctx.pipeline.submit({
                            intent: (_b = msg.description) !== null && _b !== void 0 ? _b : "",
                            requiresExecution: msg.task_type !== "research",
                            approvalMode: msg.auto_approve ? "auto-all" : undefined
                        })];
                case 24:
                    handle = _d.sent();
                    if (handle) {
                        ctx.postMessage({ type: "hermesTaskSubmitted", taskId: handle.taskId, state: handle.initial });
                    }
                    return [3 /*break*/, 26];
                case 25:
                    e_2 = _d.sent();
                    ctx.postMessage({ type: "hermesError", message: e_2 instanceof Error ? e_2.message : String(e_2) });
                    return [3 /*break*/, 26];
                case 26: return [2 /*return*/, true];
                case 27: return [4 /*yield*/, pushTasks(ctx)];
                case 28:
                    _d.sent();
                    return [2 /*return*/, true];
                case 29:
                    _d.trys.push([29, 32, , 33]);
                    return [4 /*yield*/, ctx.settingsAgent.autoFillAll()];
                case 30:
                    result = _d.sent();
                    return [4 /*yield*/, ctx.settingsAgent.getSuggestions()];
                case 31:
                    suggestions = _d.sent();
                    ctx.postMessage({
                        type: "hermesAgentAssistResult",
                        result: {
                            filled: result.filled,
                            failed: result.failed,
                            suggestions: suggestions.map(function (s) { return s.reason; }),
                            auditFindings: suggestions.map(function (s) { return s.setting + ": " + s.reason; })
                        }
                    });
                    return [3 /*break*/, 33];
                case 32:
                    e_3 = _d.sent();
                    ctx.postMessage({ type: "hermesError", message: e_3 instanceof Error ? e_3.message : String(e_3) });
                    return [3 /*break*/, 33];
                case 33: return [2 /*return*/, true];
                case 34: return [2 /*return*/, false];
            }
        });
    });
}
//# sourceMappingURL=hermes-webview.js.map