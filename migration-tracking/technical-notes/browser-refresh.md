# Measuring Integrated Browser scrolling

Use an installed VSIX in an isolated VS Code profile. High refresh is automatic. For comparisons, use the previous build with its high-refresh option enabled so both builds run with the same Chromium frame-rate behavior.

## Repeatable workload

1. Test the Agent Manager panel and the editor tab separately. Use a fresh browser context for each pair of passes, open `https://www.spiegel.de/`, and dismiss the consent dialog. Use a 393 × 689 CSS-pixel viewport at device scale 2; verify the received frame dimensions are 786 × 1378.
2. Put a fixed 72 × 4 CSS-pixel test marker in the page. Draw 18 four-pixel-wide stripes: white, black, then the low 16 bits of the rounded vertical scroll offset (least significant first, white = 1). Update on `scroll`. Ignore pointer events on the marker. Use the browser's debugger in the **isolated profile only**; do not change the production page or stream implementation to collect timings.
3. Start with the page at the top and the marker reading zero. Send pixel-mode wheel events over the upper quarter of the preview: 50 pixels every 8 ms for 6 seconds, reversing direction every 1.5 seconds. Reset to the top and repeat without reloading for the warm pass. Repeat with a fresh context. For native Chrome, use the same viewport, scale and input sequence.
4. At each webview animation callback, read the marker from the **displayed canvas** if its frame sequence has changed. Count a visible update only if the marker changes; arrival and decode counts are not display rates. Include the wait for the first update and the final gap in frame-gap percentiles. For input latency, measure from each onset/reversal to the first displayed motion in the requested direction. Report missed reversals separately rather than counting them as fast responses. Native Chrome's reference samples `scrollY` at animation callbacks; neither measurement is physical display scanout.
5. Reject trials where input was throttled (fewer than 700 events), the viewport changed, or the article did not move through the expected range (peak scroll outside 7,000–13,000 pixels). Measure peak scroll **in the source page**: if the page moved but the preview missed that motion, keep the stall. Record individual runs: live content, ads, image loading and display scheduling vary.

For lifecycle checks, close or hide the preview during animation, resize it, navigate to another document and reopen it. The capture worker should detach while hidden, present only the current document and viewport after rebinding, and fall back to host capture if it exits. Loss of the proxy must close the affected context, not allow the page to switch to direct networking.

## Installed VSIX results (macOS arm64, November 2026)

The table includes two valid pairs with the previous high-refresh VSIX, three with the worker path (including a pair after the final startup-cancellation change), and two in native Chrome. Rates and percentiles are means across passes; worst is the maximum; input latency is the median of detected onsets and reversals. Only 3 of 8 transitions were detected in the previous editor tab's first passes. All worker and native transitions were detected.

| Surface / path | Updates/s, first / warm | Warm p95 / p99 / worst gap (ms) | Worst first-pass gap (ms) | Warm input latency (ms) |
|---|---:|---:|---:|---:|
| Agent Manager, previous | 37 / 71 | 29 / 42 / 1,025 | 2,033 | 48 |
| Agent Manager, workers | 73 / 87 | 20 / 31 / 66 | 117 | 36 |
| Editor tab, previous | 10 / 45 | 88 / 142 / 262 | 3,482 | 196 |
| Editor tab, workers | 70 / 62 | 53 / 81 / 191 | 109 | 54 |
| Native Chrome | 76 / 88 | 17 / 20 / 37 | 113 | 13 |

These runs show the largest benefit from the workers during first-pass scrolling. They do not establish sustained 120 fps or native-equivalent input latency.

## Why a high update count can still feel jerky

Chrome can finish encoding an older capture after a newer one. Both are valid JPEGs; assigning sequence numbers in arrival order used to allow the old image to replace the new one. In 12 recorded scroll traces (4,891 received frames), 57 arrived behind a newer capture timestamp. Twenty-nine of those produced a backwards step during a steady-direction scroll, including one of 300 CSS pixels. Replaying the traces with a capture-order check cut observed wrong-direction steps from 58 to 29 without increasing the worst gap in any trace. This is a replay result, not a live FPS improvement.

The worker and host fallback now check Chromium's monotonic capture timestamp **before** replacing the newest image. The check waits for no frames and does not infer direction from the pixels or wheel input: a newer frame moving the other way is a legitimate reversal. Browsers without that timestamp keep arrival order. On the input side, a reversal flushes the old batch and sends the first new delta immediately, even if a display callback is already pending.

Ordering cannot fix a missing capture. In one compositor trace the source scrolled through 11 positions during a 391 ms visible pause, with only one JPEG encode completing in that interval. An installed experiment limiting Chrome to one encode in flight and returning capture credit from the webview averaged only 21–33 visible updates/s across surfaces and passes. Overlapping JPEG decode in the webview also regressed some editor runs. Neither experiment is in the shipped path.

### Installed capture-order comparison

Same workload, Chrome 158 on macOS arm64. The two extension variants differ only in whether the capture worker rejects older timestamps; both include the input changes. Two throttled trials (6 and 12 wheel inputs) were excluded, with replacement trials included. Each row has two or three valid fresh/warm pairs.

| Surface / presentation order | Updates/s, first / warm | Warm p95 / p99 / worst gap (ms) | Warm wheel-to-visible (ms) |
|---|---:|---:|---:|
| Editor, arrival | 54 / 60 | 51 / 116 / 357 | 54 |
| Editor, capture | 78 / 81 | 25 / 41 / 84 | 41 |
| Agent Manager, arrival | 69 / 83 | 25 / 34 / 92 | 47 |
| Agent Manager, capture | 59 / 62 | 50 / 94 / 224 | 70 |
| Native Chrome | 80 / 87 | 18 / 22 / 37 | 21 |

The live comparisons went in opposite directions across surfaces; they do **not** establish a throughput win. To isolate the ordering check from page variability, a separate installed-worker probe counted all arrivals and recorded which ones would pass the check on the **same** stream. It rejected 5 of 257 first-pass captures in Agent Manager and 8 of 328 in the editor; neither warm pass rejected a frame. Worst capture-arrival gaps before and after filtering were identical in all four passes (166 / 42 ms in Agent Manager; 124 / 37 ms in the editor, first / warm). This supports the ordering check as a visual correctness fix, not a solution to the remaining Chrome capture pauses.

### Hardware H.264 capture and direct binary WebSocket results

`Page.startScreencast` is capped in Chromium by `kDefaultMinCapturePeriod = 10 ms` (100 Hz ceiling) and encodes JPEGs on the CPU thread pool. Replacing it with a split-incognito `chrome.tabCapture` helper using hardware H.264 High Profile (`avc1.640033`, 30 Mbps, `latencyMode: "realtime"`), paired with a token- and `vscode-webview://`-origin-authenticated loopback binary WebSocket between the capture worker and `StreamViewport` (for both frames and immediate wheel input, with cached viewport bounds and hardware `VideoDecoder` presentation), removed Extension Host IPC and CPU JPEG encoding from the hot path.

Installed VSIX results on macOS arm64 (Chrome 158, 786 × 1378 @ 2x, 3 valid fresh/warm pairs per surface, 1 throttled 6-input editor trial excluded and replaced, 2 same-session native Chrome controls; `0` Extension Host `postMessage` frames and `0` unintended opposite-direction jumps across all runs):

| Surface / path | Updates/s, first / warm | Warm p95 / p99 / worst gap (ms) | Worst first-pass gap (ms) | First / warm input latency (ms) |
|---|---:|---:|---:|---:|
| Agent Manager, H.264 + direct WS | 84.2 / 97.1 | 17.1 / 25.1 / 100.2 | 200.4 | 30.9 / 28.2 |
| Editor tab, H.264 + direct WS | 88.2 / 96.6 | 18.1 / 30.4 / 83.4 | 92.6 | 22.2 / 25.1 |
| Native Chrome | 76.3 / 87.2 | 18.3 / 21.0 / 35.4 | 122.6 | 16.9 / 16.8 |

Remaining gaps: worst single-frame warm pauses (83–100 ms) and median wheel-to-visible latency (22–28 ms) are still above native Chrome (35 ms worst, 17 ms median). First-time VideoToolbox warmup takes ~2.9 s once per Chrome process in the background while JPEG serves initial frames immediately, then upgrades to H.264. Platforms without hardware H.264 or remote VS Code sessions without loopback WebSocket access fall back automatically to direct-WS JPEG or Extension Host `postMessage` JPEG.

### Paced 60 Hz capture, isolated-world scroll dispatch, and animated-page / boundary fixes

Testing desktop viewports (`2000×1400` / `2400×1600`) and heavily animated pages (`https://github.com/`) exposed three major causes of real-world stuttering:

1. **Uncapped spinloop on animated pages:** `--disable-frame-rate-limit` enables Chromium's `BackToBackBeginFrameSource`, causing `github.com` to run `requestAnimationFrame` at ~993 fps (229% GPU CPU + 137% renderer CPU) and produce 406–539 ms scroll/capture freezes. Removing `--disable-frame-rate-limit` keeps headless Chrome paced at 60.0 Hz (an exact 2:1 integer divisor on 120 Hz ProMotion displays) and eliminates animation overload.
2. **CDP `mouseWheel` 2-frame stall and top/bottom elastic overscroll shaking:** Chromium's `InputHandler::InjectWheelEvent` unconditionally follows every CDP `mouseWheel` (`kPhaseBegan`) with a synthetic `kPhaseEnded` event. At 60 Hz this caps scrolling at 30 fps (2 frames per tick, ~45–90 ms latency) and makes macOS Chrome repeatedly stretch and snap elastic overscroll at `scrollY === 0` and `scrollY === max` (24+ distinct vibrating frames per second). An isolated-world scroll helper (`browser-scroll.ts`) dispatches real cancelable `WheelEvent`s, respects `preventDefault()`, scrolls nested containers and Shadow DOM, chains through same-origin iframes to the parent page, and falls back to native CDP `mouseWheel` for Ctrl+wheel zoom or cross-origin iframes (with `overscroll-behavior: none` on `documentElement` as defense-in-depth).
3. **First-visit contention and keyframe stalls:** Re-enabled Chromium's HTTP cache for `https:` pages (kept disabled for `http:` local dev servers; all `browser-network.test.ts` checks pass), memoized `StreamViewport` structural target state so `console` / `title` updates do not flush layout mid-scroll, upgraded JPEG → H.264 in-place on the live worker without dropping the WebSocket, raised H.264 WS buffer cap to 2 MB and `decodeQueueSize` threshold to 12, and routed keyframe requests directly over the offscreen CDP WebSocket (~0.2 ms instead of Extension Host round-trips).

Installed VSIX results (macOS arm64, Chrome 158; 2 valid pairs per surface on `spiegel.de` @ 786×1378, plus `github.com` @ 2000×1400; `0` Extension Host `postMessage` frames and `0` opposite-direction jumps):

| Surface / site | Updates/s, first / warm | Warm p95 / p99 / worst gap (ms) | Worst first-pass gap (ms) | First / warm input latency (ms) |
|---|---:|---:|---:|---:|
| Agent Manager, `spiegel.de` (786×1378) | 55.0 / 57.4 | 24.5 / 34.8 / 50.4 | 74.9 | 36.6 / 34.2 |
| Editor tab, `spiegel.de` (786×1378) | 56.8 / 56.2 | 29.7 / 41.6 / 67.2 | 67.6 | 37.1 / 40.3 |
| Editor tab, `github.com` (2000×1400) | 58.8 / 59.2 | 25.7 / 32.2 / 38.5 | 97.6 | 59.6 / 41.0 |

Boundary check (96 rapid wheel inputs at page boundaries): `0` pixel flips at the top (`uniqueTail = 1`) and `1` at the bottom (`uniqueTail = 2`, scrollbar fade). Remaining limitation: Chromium's headless `ScreenMacHeadless` / `DelayBasedBeginFrameSource` is hardcoded to 60 Hz unless `--disable-frame-rate-limit` is set (which causes unbounded ~993 fps spinloops on animated sites), so headless Chrome cannot run paced 120 Hz natively without upstream Chromium support.
