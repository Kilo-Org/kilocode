# @kilocode/core-schemas

## 0.0.2

### Patch Changes

- [#5176](https://github.com/Kilo-Org/kilocode/pull/5176) [`6765832`](https://github.com/Kilo-Org/kilocode/commit/676583256cb405ef8fb8008f313bfe4a090e9ba0) Thanks [@Drilmo](https://github.com/Drilmo)! - Add image support to Agent Manager

    - Paste images from clipboard (Ctrl/Cmd+V) or select via file browser button
    - Works in new agent prompts, follow-up messages, and resumed sessions
    - Support for PNG, JPEG, WebP, and GIF formats (up to 4 images per message)
    - Click thumbnails to preview, hover to remove
    - New `newTask` stdin message type for initial prompts with images
    - Temp image files are automatically cleaned up when extension deactivates

- [#5173](https://github.com/Kilo-Org/kilocode/pull/5173) [`cdc3e2e`](https://github.com/Kilo-Org/kilocode/commit/cdc3e2ea32ced833b9d1d1983a4252eda3c0fdf1) Thanks [@PeterDaveHello](https://github.com/PeterDaveHello)! - Fix Zod function API usage in pollingOptionsSchema

## 0.0.1

### Patch Changes

- [#5107](https://github.com/Kilo-Org/kilocode/pull/5107) [`b2e2630`](https://github.com/Kilo-Org/kilocode/commit/b2e26304e562e516383fbf95a3fdc668d88e1487) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Upgrade to Zod v4 for consistency with CLI package
