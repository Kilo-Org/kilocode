"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vite_1 = require("vite");
const vite_plugin_solid_1 = __importDefault(require("vite-plugin-solid"));
const dev = process.env.NODE_ENV !== "production";
exports.default = (0, vite_1.defineConfig)({
    plugins: [(0, vite_plugin_solid_1.default)()],
    root: "src/webview",
    build: {
        outDir: "../../dist/webview",
        emptyOutDir: true,
        rollupOptions: {
            output: {
                entryFileNames: "index.js",
                assetFileNames: "index.[ext]",
            },
        },
    },
    server: {
        port: 5173,
        strictPort: true,
        hmr: {
            host: "localhost",
        },
    },
});
//# sourceMappingURL=vite.config.js.map