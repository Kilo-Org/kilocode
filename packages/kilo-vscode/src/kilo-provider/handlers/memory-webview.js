/**
 * memory-webview.ts
 *
 * Bridges webview messages from MemoryTab.tsx → Shiba Memory HTTP API.
 *
 * Shiba Memory endpoint: http://host.docker.internal:18789
 *
 * Message types handled:
 *   requestMemoryStatus      → GET /status, push memoryStatusLoaded
 *   memoryRecall             → POST /recall, push memoryRecallResult
 *   memoryWrite              → POST /write, push memoryWriteResult
 *   memoryAddPermission      → POST /permissions, push memoryPermissionsUpdated
 *   memoryRemovePermission   → DELETE /permissions/:agentId, push memoryPermissionsUpdated
 *   memoryRunDiagnostics     → POST /diagnostics, push memoryDiagnosticsResult
 *   memoryLoadRecallTraces   → GET /traces, push memoryRecallTracesLoaded
 *   memoryClearRecallTraces  → DELETE /traces, push memoryRecallTracesLoaded (empty)
 *   memoryClearWriteHistory  → DELETE /history, push memoryWriteHistoryLoaded (empty)
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
var SHIBA_BASE = "http://host.docker.internal:18789";
var FETCH_TIMEOUT_MS = 10000;
function shibaFetch(path, options, timeoutMs) {
    var _a;
    if (options === void 0) { options = {}; }
    if (timeoutMs === void 0) { timeoutMs = FETCH_TIMEOUT_MS; }
    return __awaiter(this, void 0, void 0, function () {
        var ctrl, timer, res, body;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    ctrl = new AbortController();
                    timer = setTimeout(function () { return ctrl.abort(); }, timeoutMs);
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, , 5, 6]);
                    return [4 /*yield*/, fetch("" + SHIBA_BASE + path, __assign(__assign({}, options), { signal: ctrl.signal, headers: __assign({ "Content-Type": "application/json" }, ((_a = options.headers) !== null && _a !== void 0 ? _a : {})) }))];
                case 2:
                    res = _b.sent();
                    if (!!res.ok) return [3 /*break*/, 4];
                    return [4 /*yield*/, res.text()["catch"](function () { return ""; })];
                case 3:
                    body = _b.sent();
                    throw new Error("Shiba " + path + " \u2192 HTTP " + res.status + ": " + body);
                case 4: return [2 /*return*/, res.json()];
                case 5:
                    clearTimeout(timer);
                    return [7 /*endfinally*/];
                case 6: return [2 /*return*/];
            }
        });
    });
}
// eslint-disable-next-line complexity
export function handleMemoryWebviewMessage(msg, ctx) {
    var _a, _b, _c, _d, _e;
    return __awaiter(this, void 0, void 0, function () {
        var _f, data, e_1, data, e_2, data, e_3, perms, e_4, perms, e_5, data, e_6, data, _g, _h, _j;
        return __generator(this, function (_k) {
            switch (_k.label) {
                case 0:
                    _f = msg.type;
                    switch (_f) {
                        case "requestMemoryStatus": return [3 /*break*/, 1];
                        case "memoryRecall": return [3 /*break*/, 5];
                        case "memoryWrite": return [3 /*break*/, 9];
                        case "memoryAddPermission": return [3 /*break*/, 13];
                        case "memoryRemovePermission": return [3 /*break*/, 18];
                        case "memoryRunDiagnostics": return [3 /*break*/, 23];
                        case "memoryLoadRecallTraces": return [3 /*break*/, 27];
                        case "memoryClearRecallTraces": return [3 /*break*/, 31];
                        case "memoryClearWriteHistory": return [3 /*break*/, 35];
                    }
                    return [3 /*break*/, 39];
                case 1:
                    _k.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, shibaFetch("/status")];
                case 2:
                    data = _k.sent();
                    ctx.postMessage(__assign({ type: "memoryStatusLoaded" }, data));
                    return [3 /*break*/, 4];
                case 3:
                    e_1 = _k.sent();
                    ctx.postMessage({
                        type: "memoryStatusLoaded",
                        connection: {
                            status: "error",
                            endpoint: SHIBA_BASE,
                            lastError: e_1 instanceof Error ? e_1.message : String(e_1)
                        },
                        connectionHistory: [],
                        entryCount: 0,
                        writeHistoryCount: 0,
                        permissions: [],
                        health: {
                            status: "unavailable",
                            lastSuccessfulWrite: null,
                            lastSuccessfulRecall: null,
                            errorRate: 1,
                            consecutiveFailures: 1
                        }
                    });
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/, true];
                case 5:
                    _k.trys.push([5, 7, , 8]);
                    return [4 /*yield*/, shibaFetch("/recall", {
                            method: "POST",
                            body: JSON.stringify({
                                query: msg.query,
                                project: (_a = msg.project) !== null && _a !== void 0 ? _a : "current"
                            })
                        })];
                case 6:
                    data = _k.sent();
                    ctx.postMessage(__assign({ type: "memoryRecallResult" }, data));
                    return [3 /*break*/, 8];
                case 7:
                    e_2 = _k.sent();
                    ctx.postMessage({
                        type: "memoryRecallResult",
                        status: "failed",
                        results: [],
                        error: e_2 instanceof Error ? e_2.message : String(e_2)
                    });
                    return [3 /*break*/, 8];
                case 8: return [2 /*return*/, true];
                case 9:
                    _k.trys.push([9, 11, , 12]);
                    return [4 /*yield*/, shibaFetch("/write", {
                            method: "POST",
                            body: JSON.stringify({
                                summary: msg.summary,
                                content: msg.content,
                                factType: msg.factType,
                                scope: msg.scope,
                                project: msg.project
                            })
                        })];
                case 10:
                    data = _k.sent();
                    ctx.postMessage(__assign({ type: "memoryWriteResult", success: true }, data));
                    return [3 /*break*/, 12];
                case 11:
                    e_3 = _k.sent();
                    ctx.postMessage({
                        type: "memoryWriteResult",
                        success: false,
                        error: e_3 instanceof Error ? e_3.message : String(e_3)
                    });
                    return [3 /*break*/, 12];
                case 12: return [2 /*return*/, true];
                case 13:
                    _k.trys.push([13, 16, , 17]);
                    return [4 /*yield*/, shibaFetch("/permissions", {
                            method: "POST",
                            body: JSON.stringify({ agentId: msg.agentId, scope: (_b = msg.scope) !== null && _b !== void 0 ? _b : "project" })
                        })];
                case 14:
                    _k.sent();
                    return [4 /*yield*/, shibaFetch("/permissions")];
                case 15:
                    perms = _k.sent();
                    ctx.postMessage({ type: "memoryPermissionsUpdated", permissions: (_c = perms.permissions) !== null && _c !== void 0 ? _c : [] });
                    return [3 /*break*/, 17];
                case 16:
                    e_4 = _k.sent();
                    ctx.postMessage({
                        type: "memoryError",
                        error: e_4 instanceof Error ? e_4.message : String(e_4)
                    });
                    return [3 /*break*/, 17];
                case 17: return [2 /*return*/, true];
                case 18:
                    _k.trys.push([18, 21, , 22]);
                    return [4 /*yield*/, shibaFetch("/permissions/" + encodeURIComponent(msg.agentId), { method: "DELETE" })];
                case 19:
                    _k.sent();
                    return [4 /*yield*/, shibaFetch("/permissions")];
                case 20:
                    perms = _k.sent();
                    ctx.postMessage({ type: "memoryPermissionsUpdated", permissions: (_d = perms.permissions) !== null && _d !== void 0 ? _d : [] });
                    return [3 /*break*/, 22];
                case 21:
                    e_5 = _k.sent();
                    ctx.postMessage({
                        type: "memoryError",
                        error: e_5 instanceof Error ? e_5.message : String(e_5)
                    });
                    return [3 /*break*/, 22];
                case 22: return [2 /*return*/, true];
                case 23:
                    _k.trys.push([23, 25, , 26]);
                    return [4 /*yield*/, shibaFetch("/diagnostics", { method: "POST" }, 30000)];
                case 24:
                    data = _k.sent();
                    ctx.postMessage(__assign({ type: "memoryDiagnosticsResult" }, data));
                    return [3 /*break*/, 26];
                case 25:
                    e_6 = _k.sent();
                    ctx.postMessage({
                        type: "memoryDiagnosticsResult",
                        connectivity: false,
                        writeTest: false,
                        recallTest: false,
                        latencyMs: 0,
                        errors: [e_6 instanceof Error ? e_6.message : String(e_6)]
                    });
                    return [3 /*break*/, 26];
                case 26: return [2 /*return*/, true];
                case 27:
                    _k.trys.push([27, 29, , 30]);
                    return [4 /*yield*/, shibaFetch("/traces")];
                case 28:
                    data = _k.sent();
                    ctx.postMessage({ type: "memoryRecallTracesLoaded", traces: (_e = data.traces) !== null && _e !== void 0 ? _e : [] });
                    return [3 /*break*/, 30];
                case 29:
                    _g = _k.sent();
                    ctx.postMessage({ type: "memoryRecallTracesLoaded", traces: [] });
                    return [3 /*break*/, 30];
                case 30: return [2 /*return*/, true];
                case 31:
                    _k.trys.push([31, 33, , 34]);
                    return [4 /*yield*/, shibaFetch("/traces", { method: "DELETE" })];
                case 32:
                    _k.sent();
                    return [3 /*break*/, 34];
                case 33:
                    _h = _k.sent();
                    return [3 /*break*/, 34];
                case 34:
                    ctx.postMessage({ type: "memoryRecallTracesLoaded", traces: [] });
                    return [2 /*return*/, true];
                case 35:
                    _k.trys.push([35, 37, , 38]);
                    return [4 /*yield*/, shibaFetch("/history", { method: "DELETE" })];
                case 36:
                    _k.sent();
                    return [3 /*break*/, 38];
                case 37:
                    _j = _k.sent();
                    return [3 /*break*/, 38];
                case 38:
                    ctx.postMessage({ type: "memoryWriteHistoryLoaded", history: [] });
                    return [2 /*return*/, true];
                case 39: return [2 /*return*/, false];
            }
        });
    });
}
//# sourceMappingURL=memory-webview.js.map