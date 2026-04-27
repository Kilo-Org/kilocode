/**
 * Authentication handlers — extracted from KiloProvider.
 *
 * Manages login (device auth flow), logout, organization switching,
 * and profile refresh. No vscode dependency.
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
import { getErrorMessage } from "../../kilo-provider-utils";
/**
 * Handle login via the provider OAuth device-auth flow.
 * Sends device auth messages so the webview can display QR code, code, and timer.
 *
 * @param attempt - The current login attempt counter value (pre-incremented by caller).
 * @param getAttempt - Returns the latest attempt counter (may have changed if user cancelled).
 */
export function handleLogin(ctx, attempt, getAttempt) {
    var _a;
    return __awaiter(this, void 0, void 0, function () {
        var dir, auth, match, code, profile, error_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!ctx.client)
                        return [2 /*return*/];
                    console.log("[Kilo New] KiloProvider: 🔐 Starting login flow...");
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 6, , 7]);
                    dir = ctx.getWorkspaceDirectory();
                    return [4 /*yield*/, ctx.client.provider.oauth.authorize({ providerID: "kilo", method: 0, directory: dir }, { throwOnError: true })];
                case 2:
                    auth = (_b.sent()).data;
                    console.log("[Kilo New] KiloProvider: 🔐 Got auth URL:", auth.url);
                    match = (_a = auth.instructions) === null || _a === void 0 ? void 0 : _a.match(/code:\s*(\S+)/i);
                    code = match ? match[1] : undefined;
                    // Send device auth details to webview
                    ctx.postMessage({
                        type: "deviceAuthStarted",
                        code: code,
                        verificationUrl: auth.url,
                        expiresIn: 900
                    });
                    // Step 2: Wait for callback (blocks until polling completes)
                    return [4 /*yield*/, ctx.client.provider.oauth.callback({ providerID: "kilo", method: 0, directory: dir }, { throwOnError: true })
                        // Check if this attempt was cancelled
                    ];
                case 3:
                    // Step 2: Wait for callback (blocks until polling completes)
                    _b.sent();
                    // Check if this attempt was cancelled
                    if (attempt !== getAttempt())
                        return [2 /*return*/];
                    console.log("[Kilo New] KiloProvider: 🔐 Login successful");
                    return [4 /*yield*/, ctx.disposeGlobal()
                        // Step 3: Fetch profile and push to webview
                    ];
                case 4:
                    _b.sent();
                    return [4 /*yield*/, ctx.client.kilo.profile(undefined, { throwOnError: true })];
                case 5:
                    profile = (_b.sent()).data;
                    ctx.postMessage({ type: "profileData", data: profile });
                    ctx.postMessage({ type: "deviceAuthComplete" });
                    return [3 /*break*/, 7];
                case 6:
                    error_1 = _b.sent();
                    if (attempt !== getAttempt())
                        return [2 /*return*/];
                    ctx.postMessage({
                        type: "deviceAuthFailed",
                        error: getErrorMessage(error_1) || "Login failed"
                    });
                    return [3 /*break*/, 7];
                case 7: return [2 /*return*/];
            }
        });
    });
}
/** Handle logout: remove auth credentials and clear profile. */
export function handleLogout(ctx) {
    return __awaiter(this, void 0, void 0, function () {
        var error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!ctx.client)
                        return [2 /*return*/];
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 5, , 6]);
                    console.log("[Kilo New] KiloProvider: 🚪 Logging out...");
                    return [4 /*yield*/, ctx.client.auth.remove({ providerID: "kilo" }, { throwOnError: true })];
                case 2:
                    _a.sent();
                    console.log("[Kilo New] KiloProvider: 🚪 Logged out successfully");
                    ctx.postMessage({ type: "profileData", data: null });
                    return [4 /*yield*/, ctx.disposeGlobal()];
                case 3:
                    _a.sent();
                    return [4 /*yield*/, ctx.fetchAndSendProviders()];
                case 4:
                    _a.sent();
                    return [3 /*break*/, 6];
                case 5:
                    error_2 = _a.sent();
                    console.error("[Kilo New] KiloProvider: ❌ Logout failed:", error_2);
                    ctx.postMessage({
                        type: "error",
                        message: getErrorMessage(error_2) || "Failed to logout"
                    });
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/];
            }
        });
    });
}
/**
 * Handle organization switch.
 * Persists the selection and refreshes profile + providers since both change with org context.
 */
export function handleSetOrganization(ctx, organizationId) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function () {
        var error_3, result, profileError_1, result, error_4, error_5, error_6;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    if (!ctx.client)
                        return [2 /*return*/];
                    console.log("[Kilo New] KiloProvider: Switching organization:", organizationId !== null && organizationId !== void 0 ? organizationId : "personal");
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 8]);
                    return [4 /*yield*/, ctx.client.kilo.organization.set({ organizationId: organizationId }, { throwOnError: true })];
                case 2:
                    _c.sent();
                    return [3 /*break*/, 8];
                case 3:
                    error_3 = _c.sent();
                    console.error("[Kilo New] KiloProvider: Failed to switch organization:", error_3);
                    _c.label = 4;
                case 4:
                    _c.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, ctx.client.kilo.profile()];
                case 5:
                    result = _c.sent();
                    ctx.postMessage({ type: "profileData", data: (_a = result.data) !== null && _a !== void 0 ? _a : null });
                    return [3 /*break*/, 7];
                case 6:
                    profileError_1 = _c.sent();
                    console.error("[Kilo New] KiloProvider: Failed to refresh profile after org switch error:", profileError_1);
                    return [3 /*break*/, 7];
                case 7: return [2 /*return*/];
                case 8: return [4 /*yield*/, ctx.disposeGlobal()
                    // Org switch succeeded — refresh profile and providers independently (best-effort)
                ];
                case 9:
                    _c.sent();
                    _c.label = 10;
                case 10:
                    _c.trys.push([10, 12, , 13]);
                    return [4 /*yield*/, ctx.client.kilo.profile()];
                case 11:
                    result = _c.sent();
                    ctx.postMessage({ type: "profileData", data: (_b = result.data) !== null && _b !== void 0 ? _b : null });
                    return [3 /*break*/, 13];
                case 12:
                    error_4 = _c.sent();
                    console.error("[Kilo New] KiloProvider: Failed to refresh profile after org switch:", error_4);
                    return [3 /*break*/, 13];
                case 13:
                    _c.trys.push([13, 15, , 16]);
                    return [4 /*yield*/, ctx.fetchAndSendProviders()];
                case 14:
                    _c.sent();
                    return [3 /*break*/, 16];
                case 15:
                    error_5 = _c.sent();
                    console.error("[Kilo New] KiloProvider: Failed to refresh providers after org switch:", error_5);
                    return [3 /*break*/, 16];
                case 16:
                    _c.trys.push([16, 18, , 19]);
                    return [4 /*yield*/, ctx.fetchAndSendAgents()];
                case 17:
                    _c.sent();
                    return [3 /*break*/, 19];
                case 18:
                    error_6 = _c.sent();
                    console.error("[Kilo New] KiloProvider: Failed to refresh agents after org switch:", error_6);
                    return [3 /*break*/, 19];
                case 19: return [2 /*return*/];
            }
        });
    });
}
/** Handle profile refresh request. */
export function handleRefreshProfile(ctx) {
    var _a;
    return __awaiter(this, void 0, void 0, function () {
        var result;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!ctx.client)
                        return [2 /*return*/];
                    console.log("[Kilo New] KiloProvider: 🔄 Refreshing profile...");
                    return [4 /*yield*/, ctx.client.kilo.profile()["catch"](function () { return ({ data: null }); })];
                case 1:
                    result = _b.sent();
                    ctx.postMessage({ type: "profileData", data: (_a = result.data) !== null && _a !== void 0 ? _a : null });
                    return [2 /*return*/];
            }
        });
    });
}
//# sourceMappingURL=auth.js.map