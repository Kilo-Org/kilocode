/**
 * Question handlers — extracted from KiloProvider.
 *
 * Manages question reply and reject flows from the tool question UI,
 * plus recovery of pending questions after SSE reconnections or child-session syncs.
 * No vscode dependency.
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
var __spreadArrays = (this && this.__spreadArrays) || function () {
    for (var s = 0, i = 0, il = arguments.length; i < il; i++) s += arguments[i].length;
    for (var r = Array(s), k = 0, i = 0; i < il; i++)
        for (var a = arguments[i], j = 0, jl = a.length; j < jl; j++, k++)
            r[k] = a[j];
    return r;
};
/**
 * Fetch all pending questions from the backend and forward any that belong
 * to tracked sessions to the webview. Mirrors fetchAndSendPendingPermissions —
 * called after child-session sync and after SSE reconnects so missed
 * question.asked events don't leave the server blocked indefinitely.
 */
export function fetchAndSendPendingQuestions(ctx) {
    return __awaiter(this, void 0, void 0, function () {
        var dirs, seen, _i, dirs_1, dir, data, _a, data_1, q, error_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!ctx.client)
                        return [2 /*return*/];
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 6, , 7]);
                    dirs = new Set(__spreadArrays([ctx.getWorkspaceDirectory()], ctx.sessionDirectories.values()));
                    seen = new Set();
                    _i = 0, dirs_1 = dirs;
                    _b.label = 2;
                case 2:
                    if (!(_i < dirs_1.length)) return [3 /*break*/, 5];
                    dir = dirs_1[_i];
                    return [4 /*yield*/, ctx.client.question.list({ directory: dir })];
                case 3:
                    data = (_b.sent()).data;
                    if (!data)
                        return [3 /*break*/, 4];
                    for (_a = 0, data_1 = data; _a < data_1.length; _a++) {
                        q = data_1[_a];
                        if (seen.has(q.id))
                            continue;
                        seen.add(q.id);
                        if (!ctx.trackedSessionIds.has(q.sessionID))
                            continue;
                        ctx.postMessage({
                            type: "questionRequest",
                            question: {
                                id: q.id,
                                sessionID: q.sessionID,
                                questions: q.questions,
                                blocking: q.blocking,
                                tool: q.tool
                            }
                        });
                    }
                    _b.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 2];
                case 5: return [3 /*break*/, 7];
                case 6:
                    error_1 = _b.sent();
                    console.error("[Kilo New] KiloProvider: Failed to fetch pending questions:", error_1);
                    return [3 /*break*/, 7];
                case 7: return [2 /*return*/];
            }
        });
    });
}
/** Handle question reply from the webview. */
export function handleQuestionReply(ctx, requestID, answers, sessionID) {
    return __awaiter(this, void 0, void 0, function () {
        var sid, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!ctx.client) {
                        ctx.postMessage({ type: "questionError", requestID: requestID });
                        return [2 /*return*/, false];
                    }
                    sid = sessionID !== null && sessionID !== void 0 ? sessionID : ctx.currentSessionId;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, ctx.client.question.reply({ requestID: requestID, answers: answers, directory: ctx.getWorkspaceDirectory(sid) }, { throwOnError: true })];
                case 2:
                    _a.sent();
                    return [2 /*return*/, true];
                case 3:
                    error_2 = _a.sent();
                    console.error("[Kilo New] KiloProvider: Failed to reply to question:", error_2);
                    ctx.postMessage({ type: "questionError", requestID: requestID });
                    return [2 /*return*/, false];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/** Handle question reject (dismiss) from the webview. */
export function handleQuestionReject(ctx, requestID, sessionID) {
    return __awaiter(this, void 0, void 0, function () {
        var sid, error_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!ctx.client) {
                        ctx.postMessage({ type: "questionError", requestID: requestID });
                        return [2 /*return*/, false];
                    }
                    sid = sessionID !== null && sessionID !== void 0 ? sessionID : ctx.currentSessionId;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, ctx.client.question.reject({ requestID: requestID, directory: ctx.getWorkspaceDirectory(sid) }, { throwOnError: true })];
                case 2:
                    _a.sent();
                    return [2 /*return*/, true];
                case 3:
                    error_3 = _a.sent();
                    console.error("[Kilo New] KiloProvider: Failed to reject question:", error_3);
                    ctx.postMessage({ type: "questionError", requestID: requestID });
                    return [2 /*return*/, false];
                case 4: return [2 /*return*/];
            }
        });
    });
}
//# sourceMappingURL=question.js.map