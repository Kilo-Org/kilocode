import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
const dev = process.env.NODE_ENV !== "production";
export default defineConfig({
    plugins: [solid()],
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
//# sourceMappingURL=vite.config.mjs.map