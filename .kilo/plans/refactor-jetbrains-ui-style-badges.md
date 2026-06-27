# Refactor JetBrains Badge Styles

## Goal

Centralize all JetBrains badge color choices under `UiStyle.Badge`, replace settings badge tones with explicit badge style objects, and update badge renderers to consume those objects instead of separate background/foreground color functions.

## Proposed Design

1. Add `UiStyle.Badge` in `frontend/src/main/kotlin/ai/kilocode/client/ui/UiStyle.kt`.
2. Define a nested style contract, for example `UiStyle.Badge.Style`, with `bg(): Color` and `fg(): Color`.
3. Add nested objects with the correctly spelled names:
   - `Primary`: current activity/accent badge palette, blue background and white foreground.
   - `Secondary`: current grey settings badge palette, using `Badge.background` / `Badge.foreground` with the current fallbacks.
   - `Free`: current free-model badge palette from `ModelText.freeBg()` plus the current free badge foreground.
   - `Alert`: current running badge palette.
4. Remove badge-specific color functions from `UiStyle.Colors`: `badgeBg`, `badgeFg`, `settingsBadgeBg`, `settingsBadgeFg`, `runningBadgeBg`, `runningBadgeFg`, `activityBadgeBg`, `activityBadgeFg`, `warningBadgeBg`, and `warningBadgeFg`.
5. Keep non-badge helpers such as `warningLabelForeground`, `bright`, and `blend` where still used.

## Implementation Steps

1. Update `FilledBadgeIcon` to accept a `UiStyle.Badge.Style` instead of raw `bg` and `fg` colors.
   - Paint by calling `style.bg()` and `style.fg()`.
   - Keep `text` available for existing tests.

2. Replace settings badge tone with explicit styles.
   - In `settings/base/SettingsListModel.kt`, remove `SettingsBadgeTone`.
   - Change `SettingsBadge` to `data class SettingsBadge(val text: String, val style: UiStyle.Badge.Style = UiStyle.Badge.Secondary)`.
   - In `settings/base/SettingsListRenderer.kt`, replace the `when (badge.tone)` color mapping with `FilledBadgeIcon(badge.text, badge.style)`.

3. Update settings call sites.
   - `AgentsConfigurable.kt`: remove `SettingsBadgeTone`; use `UiStyle.Badge.Alert` for deprecated badges; default secondary for subagent/custom/hidden unless a different style is intentionally requested.
   - `SkillsConfigurable.kt`: remove `SettingsBadgeTone`; use `UiStyle.Badge.Primary` for the custom badge and default secondary for builtin.
   - `WorkflowsConfigurable.kt` and `ProviderListRows.kt`: keep default secondary badges.

4. Move free-model badge color ownership into `UiStyle.Badge.Free`.
   - In `ModelPickerRenderer.kt`, construct `FilledBadgeIcon(ModelText.freeLabel(), UiStyle.Badge.Free)`.
   - In `ModelPicker.kt`, remove `ModelText.freeBg()` if it is no longer used.
   - Remove now-unused `JBColor` imports from affected files.

5. Update session activity badges.
   - In `SessionActivityKind.kt`, replace `bg()` / `fg()` with a `style()` function returning `UiStyle.Badge.Alert` for `RUNNING` and `UiStyle.Badge.Primary` for `LOGIN_REQUIRED`, `PERMISSION`, `PLAN`, and `QUESTION`.
   - Update `HistoryListRenderer.kt` and `RecentsList.kt` to pass `it.style()` to `FilledBadgeIcon`.

6. Update account and mode badges.
   - In `SessionAccountOverlay.kt`, replace balance badge raw colors with `UiStyle.Badge.Secondary`.
   - In `ModePickerRenderer.kt`, convert the deprecated mode badge to use `FilledBadgeIcon(KiloBundle.message("mode.picker.deprecated"), UiStyle.Badge.Alert)` so it uses the centralized alert badge style.
   - Remove `RoundedLineBorder` and border/color setup that only existed for the old outlined deprecated badge.

7. Clean up imports and verify there are no remaining call sites for old badge color functions or `SettingsBadgeTone`.

## Files Expected To Change

- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/ui/UiStyle.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/ui/FilledBadgeIcon.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/base/SettingsListModel.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/base/SettingsListRenderer.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/agentbehavior/AgentsConfigurable.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/agentbehavior/SkillsConfigurable.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/session/SessionActivityKind.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/session/history/HistoryListRenderer.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/session/ui/empty/RecentsList.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/session/ui/account/SessionAccountOverlay.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/session/ui/model/ModelPickerRenderer.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/session/ui/model/ModelPicker.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/session/ui/mode/ModePickerRenderer.kt`

## Tests And Verification

1. Run focused searches after editing:
   - No `SettingsBadgeTone` remains.
   - No `UiStyle.Colors.*Badge*` badge color functions remain.
   - `FilledBadgeIcon(` call sites all pass a `UiStyle.Badge.*` style.
2. Run the smallest relevant JetBrains check from `packages/kilo-jetbrains/`:
   - `bun run typecheck`
3. If typecheck is insufficient or changed tests fail locally, run focused frontend tests covering these renderers:
   - `UiStyleTest`
   - `ModelPickerTest`
   - `ModePickerTest`
   - `HistoryControllerTest`
   - `EmptySessionPanelTest`
   - settings UI tests that assert badge text

## Notes

- The object should be named `Secondary`, not `Seconday` / `Secondaty`.
- This is JetBrains-only UI code, so no `kilocode_change` markers are needed.
- This is an internal style refactor and does not require SDK regeneration or CLI artifact refresh.
