# Changelog

## 7.4.24

### Patch Changes

- [#13470](https://github.com/Kilo-Org/kilocode/pull/13470) [`17bef75`](https://github.com/Kilo-Org/kilocode/commit/17bef75509e6fc0b8199fb19bba0ebdafb21c223) - Stop showing a running badge for a session that was just deleted.

## 7.5.0

### Minor Changes

- [#13239](https://github.com/Kilo-Org/kilocode/pull/13239) [`3b8b18f`](https://github.com/Kilo-Org/kilocode/commit/3b8b18ff33d2a51b620859e5bc644424ed6d5ae2) - Add an Advanced settings page with a Logging section to configure diagnostic log level and message previews, reveal the log in your file manager, and download the backend log in remote development.

- [#13242](https://github.com/Kilo-Org/kilocode/pull/13242) [`d9b7f7c`](https://github.com/Kilo-Org/kilocode/commit/d9b7f7c6bc45693ffbbbbfcb4cd732b827e42576) - Show proposed file changes in permission prompts before approval.

- [#13240](https://github.com/Kilo-Org/kilocode/pull/13240) [`6bd3e4b`](https://github.com/Kilo-Org/kilocode/commit/6bd3e4b2c00235467aa0698e9290989ce926bab2) - Support opening, editing, and deleting workflows from JetBrains settings.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`59d1ec8`](https://github.com/Kilo-Org/kilocode/commit/59d1ec8a22b8fc055c988db365ec89fd3aa66c43) - Reorder Agent Manager worktrees by dragging them in the JetBrains plugin.

- [#13255](https://github.com/Kilo-Org/kilocode/pull/13255) [`cbd4b1c`](https://github.com/Kilo-Org/kilocode/commit/cbd4b1cbf3ead7a5311bd673e8d03b18b7129392) - Open sub-agent task sessions in read-only editor tabs from JetBrains task cards.

### Patch Changes

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`ac98f5c`](https://github.com/Kilo-Org/kilocode/commit/ac98f5c77460d9627ccc3e6b1a9bc09bfd327bb3) - Show compact Agent Manager activity icons for running and waiting sessions while keeping idle rows aligned with a smaller idle dot.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`98928ae`](https://github.com/Kilo-Org/kilocode/commit/98928aeed0c10cfe82ca2011bc49b437008bb62c) - Offer Move to Worktree in the chat toolbar whenever the repository has local changes, even before the chat has a session — the worktree gets your changes and starts its own session. New Worktree from the chat toolbar now opens its dialog first and only switches to Agents once you confirm, and the dialog opens narrower.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`e9f56d4`](https://github.com/Kilo-Org/kilocode/commit/e9f56d48afb1a9117f102ebfd680077012af1452) - Keep session header popups beside the chat by choosing the roomier left or right side and sizing them so IntelliJ does not flip them above or below.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`d24cedd`](https://github.com/Kilo-Org/kilocode/commit/d24cedd170353033b7886ed27359c378f0990df5) - Use regular PR title text and vertically center the PR badge in the JetBrains chat tool window.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`32573a0`](https://github.com/Kilo-Org/kilocode/commit/32573a0a1d94c4369ce5ee8a69b9e11c1cbf5e8d) - Show the chat New Worktree and Move to Worktree actions only while the session is idle, and keep the transcript pinned to the newest message when that row appears or disappears.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`f73f947`](https://github.com/Kilo-Org/kilocode/commit/f73f9474ec9ee893ac58fca0b65d55009d451daf) - Add standard horizontal padding to the empty chat recent sessions list.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`31b7297`](https://github.com/Kilo-Org/kilocode/commit/31b7297dd05264e4b665ad3d2248e11ecc9a8ae1) - Keep list descriptions muted while their row is selected, mute the worktree row icons to match the description text, and paint the running spinner in the neutral icon grey so it stays legible in light and dark themes.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`f60e8dc`](https://github.com/Kilo-Org/kilocode/commit/f60e8dc84165fc4bbdd13a04218265fdb13da545) - Keep settings, history, and session lists on the same row and scroll position when they refresh, and select the neighbouring row after a delete.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`07d2189`](https://github.com/Kilo-Org/kilocode/commit/07d2189d319c47e78e70ed428b96abe4fd33de18) - Keep Agent Manager worktree selection stable when reordering worktrees and switching tabs.

- [#13239](https://github.com/Kilo-Org/kilocode/pull/13239) [`f292625`](https://github.com/Kilo-Org/kilocode/commit/f292625b6d264040e1379b606336631f1ca93e2f) - Use `kilo.log` as the active JetBrains plugin diagnostic log, rotate old logs to `kilo.log.0` and `kilo.log.1`, and delete legacy `kilo-dev.log*` files when logging starts.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`082b38b`](https://github.com/Kilo-Org/kilocode/commit/082b38b2349aaf5b02f22dadf4bec2eff228c4c0) - Fix an IDE freeze when a chat session reports an error, which could hang the whole IDE while opening a worktree session editor.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`34a7eb3`](https://github.com/Kilo-Org/kilocode/commit/34a7eb34a1b9ea945a613ef0df1685676dc479a6) - Use the Kilo running spinner across session progress indicators.

- [#13287](https://github.com/Kilo-Org/kilocode/pull/13287) [`09a08fb`](https://github.com/Kilo-Org/kilocode/commit/09a08fbac6073f67abd1360be329f29cdf1218b5) - Keep the slash-command completion popup open while typing quickly and reopen it if it closes mid-token, so fast typing filters commands instead of dismissing the list. Refresh the popup when server commands finish loading, and return focus to the prompt after picking a model, agent, or reasoning option from a slash command.

- [#13242](https://github.com/Kilo-Org/kilocode/pull/13242) [`94c01f2`](https://github.com/Kilo-Org/kilocode/commit/94c01f28565fe7b17b956250fbbf0cb3165c9afd) - Show why and how each tool call was allowed. Expanded tool cards (edits, shell commands, and every other tool) now display a shield footer such as "Auto-approved by your global config", including the matched rule or agent and an outside-workspace note. A new "Show approval reason on tool cards" toggle at the bottom of Auto-Approve settings (on by default) controls the footer.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`2aee16b`](https://github.com/Kilo-Org/kilocode/commit/2aee16b2ebbf4d9c607840e29f83755fd444fd9f) - Show the JetBrains tool window Chat and Agents views as tabs with shorter labels.

- [#13423](https://github.com/Kilo-Org/kilocode/pull/13423) [`047c989`](https://github.com/Kilo-Org/kilocode/commit/047c9893a209aee6d0c0df98fbdf07325c69af6b) - Show worktree session titles in regular weight, keep the account switcher hidden when a new worktree starts with a prompt, add new worktrees at the top of the Agent Manager list, keep the running indicator on worktree rows when a stopped session is resumed, mark failed and waiting sessions on their worktree row and in session lists, keep the Agents tab notification dot up until every session that needs you is resolved, and keep session card popups inside the visible session view while pointing at their card.

- [#13423](https://github.com/Kilo-Org/kilocode/pull/13423) [`a5f62bc`](https://github.com/Kilo-Org/kilocode/commit/a5f62bc2dbfd5f857eaaab51003941c18c0a779a) - Keep the PR badge in the JetBrains Agent Manager worktree list clickable and aligned with the rest of the row.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`34a7eb3`](https://github.com/Kilo-Org/kilocode/commit/34a7eb34a1b9ea945a613ef0df1685676dc479a6) - Show branch icons on Agent Manager worktree rows again, and mark the current checkout with a local machine icon.

- [#13431](https://github.com/Kilo-Org/kilocode/pull/13431) [`2127b8b`](https://github.com/Kilo-Org/kilocode/commit/2127b8b4ebb379ab5734dcf989e4817423655f13) - Keep JetBrains Agent Manager worktrees in the main repository storage, prevent nested worktree deletion from removing child worktrees, and show a clear missing-folder error for deleted workspaces.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`d4f869d`](https://github.com/Kilo-Org/kilocode/commit/d4f869d971a20e1a254e7994de4d40093609b10f) - Scope chat session history to the worktree you have open, so a worktree no longer lists sessions from the main checkout or sibling worktrees, and show sessions started in another project frame in Agent Manager as they happen.

- [#13423](https://github.com/Kilo-Org/kilocode/pull/13423) [`80e8213`](https://github.com/Kilo-Org/kilocode/commit/80e82130cd3f40af5ae5977bec9245f5404fd4c7) - Let session overlays such as the connection banner take the pointer over from the transcript beneath them, so a covered card no longer stays hovered or keeps its popup open behind the overlay.

- [#13423](https://github.com/Kilo-Org/kilocode/pull/13423) [`e1e0f75`](https://github.com/Kilo-Org/kilocode/commit/e1e0f7538142b9c86e09d7af6e5c803acac37db3) - Render Agent Manager worktree list labels in normal weight with quieter idle icons, tint monochrome row icons to the selection foreground while leaving status icons colored, and clear a deleted session's question/error status from the session list, worktree list, and tab attention dot.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`0161c3a`](https://github.com/Kilo-Org/kilocode/commit/0161c3a4baf1c710e96dc60de58927f629c940c5) - Improve JetBrains Agent Manager session status badges, selection persistence, and PR badge theming.

- [#13217](https://github.com/Kilo-Org/kilocode/pull/13217) [`254acc9`](https://github.com/Kilo-Org/kilocode/commit/254acc92a4fdf782404e7fb807a0bbea5e7b3287) - Avoid showing JetBrains internal error popups when Kilo workspace data fails to load, and include HTTP status and response details in diagnostics.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`3e152b7`](https://github.com/Kilo-Org/kilocode/commit/3e152b75fd98ac2cf5f56ddbfa0b94b017b12e45) - Show the current branch first in Agent Manager and replace worktree activity tags with status icons. Running, question, and error activity now share one color between the row icon and the text badge, add an error state, and surface a notification dot on the Agents tab when a session needs attention.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`d94f2bf`](https://github.com/Kilo-Org/kilocode/commit/d94f2bf1c944129054dda983ff1df3d50ddced90) - Report failures when moving a chat into a worktree instead of leaving the row stuck, clean up worktrees left by a failed move, and stop clicks in empty list space from selecting the last row.

- [#13315](https://github.com/Kilo-Org/kilocode/pull/13315) [`ce5a71e`](https://github.com/Kilo-Org/kilocode/commit/ce5a71e5f07fb3ab50f4215278f6e2a1557ef148) - Show worktree creation and move progress in the Agent Manager row instead of the chat dock.

## 7.5.0

### Minor Changes

- [#13092](https://github.com/Kilo-Org/kilocode/pull/13092) [`1500843`](https://github.com/Kilo-Org/kilocode/commit/1500843a342d66b56bc64ac26fa6f9d60e7d255f) - Show the collapsed hover preview on more transcript cards: grep, glob, other tool calls, and to-dos now open the same popup that shell and diffs use.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`46eac53`](https://github.com/Kilo-Org/kilocode/commit/46eac53716dd4c5eb31e782f55f08bcf13772ad7) - Reveal rename and delete buttons on hover in JetBrains session history, rename sessions through an inline popover instead of a modal dialog, and move the selection to the neighbouring session after deleting the selected one.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`b1a8893`](https://github.com/Kilo-Org/kilocode/commit/b1a8893f142807085c4312efac62379fbcc953d5) - Show provider errors and interrupted or failed turns in the JetBrains chat instead of returning silently to idle.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`919d312`](https://github.com/Kilo-Org/kilocode/commit/919d312fa4e14f44f0ad88283bbf60a1bb8a79a0) - Show an activity badge on each Agent Manager worktree row, reflecting whether that worktree's sessions are running or waiting on a question or permission — even when the worktree's editor tab is not open.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`a678e54`](https://github.com/Kilo-Org/kilocode/commit/a678e549f5381db7625cc61e0897e9cb54465595) - Name Agent Manager worktrees from the first session's title. When a worktree still uses its default branch name, the title the agent generates for its first session becomes the worktree name — updating both the worktree list and the editor live as the name arrives. Placeholder session names are ignored so only the real agent title is adopted, and worktrees you have renamed yourself are left untouched. The worktree session list now also shows agent-generated session titles as they stream in.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`4100415`](https://github.com/Kilo-Org/kilocode/commit/4100415acab6efaacf438ccb0648e29acd7b22a2) - Show worktree change counts, ahead/behind counts, and pull request badges in JetBrains Agent Manager worktree rows and editor headers.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`106b5f4`](https://github.com/Kilo-Org/kilocode/commit/106b5f4d5aea047e21a0ddc923d98e49c78ccef8) - Add an "Open worktree in new window" button to the Agent Manager worktree toolbar that opens the worktree directory in a new IDE frame. The project is opened on the backend/host, so it also works in remote development.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`b6bd9f2`](https://github.com/Kilo-Org/kilocode/commit/b6bd9f224c8c7dda632bfa16f961211f66f49a25) - Support managing sessions directly from Agent Manager worktree editor tabs, start a new session when opening an empty worktree editor, and hide non-Agent-Manager git worktrees from the worktree list.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`1d964e0`](https://github.com/Kilo-Org/kilocode/commit/1d964e08254bf06de4c395bcc63a71b12f37142b) - Add a Terminal button to the Agent Manager worktree header that opens (or focuses) a terminal in the worktree's directory, reusing one terminal tab per worktree. The terminal tab is labelled with the same worktree name shown in the worktree list and editor tab, and it updates when the worktree is renamed or its pull request changes. The worktree header actions now use flat, hoverable toolbar buttons, and the branch-changes badge shows the changed-file count and lines added/removed, opening the branch diff when clicked.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`d522ff8`](https://github.com/Kilo-Org/kilocode/commit/d522ff80e25e220c46cda6ed621e29025c302259) - Support renaming Agent Manager worktrees and worktree sessions from the JetBrains plugin.

### Patch Changes

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`f3d1134`](https://github.com/Kilo-Org/kilocode/commit/f3d11341c4b6d47a047e7f04dd46817e64a77bb1) - Use equal-height rows by default in Agent Manager and settings lists, keeping variable-height rows only for provider settings.

- [#13092](https://github.com/Kilo-Org/kilocode/pull/13092) [`e8a40e1`](https://github.com/Kilo-Org/kilocode/commit/e8a40e1502c03a996d1452c2c9cf49c99f288e83) - Remove borders around JetBrains prompt bubbles and markdown code surfaces, and round the collapsed card hover highlight and markdown code blocks to match the prompt bubble.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`8db5a8c`](https://github.com/Kilo-Org/kilocode/commit/8db5a8c5c962bcbd3093e7561e224350d3a11f4c) - Center JetBrains session content at a 98-column readable width on wide panels.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`579245d`](https://github.com/Kilo-Org/kilocode/commit/579245d8f24310f93a923f3a630922141341a386) - Use the standard prompt with mode, model, and effort controls when creating new worktrees.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`d1ae907`](https://github.com/Kilo-Org/kilocode/commit/d1ae907746e0fc74c1f7f85d933db4214665fd3c) - Show worktree row actions in a hover menu instead of inline rename and delete buttons.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`430306e`](https://github.com/Kilo-Org/kilocode/commit/430306e37dc26b87c57df77c34f9c9f9b76dffb0) - Show synchronized Agent Manager and worktree editor banners when Git or GitHub CLI PR status checks need installation or authorization.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`aafde0b`](https://github.com/Kilo-Org/kilocode/commit/aafde0bf7e1b3263aacbff3a9c476af89dc2929d) - Show Agent Manager row actions only while hovering worktree and session rows.

- [#13092](https://github.com/Kilo-Org/kilocode/pull/13092) [`3e617c1`](https://github.com/Kilo-Org/kilocode/commit/3e617c12aa6204e3aea48ef692f1e5b6b3c35dfb) - Fix action button border artifacts in JetBrains Islands Light session dialogs.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`aadf773`](https://github.com/Kilo-Org/kilocode/commit/aadf773f281c837bf53a1978bb9d0ccc4ea5e707) - Show a Beta badge on the Agent Manager tool window tab.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`89532bb`](https://github.com/Kilo-Org/kilocode/commit/89532bb897102ca64369a67dd62513e72d92828b) - Show pull request titles and clearer multi-line badge tooltips in the Agent Manager worktree list.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`b2015b8`](https://github.com/Kilo-Org/kilocode/commit/b2015b864208601aa290a1c05c7eb1384e0e7034) - Keep the JetBrains plugin connected when the optional profile request returns Bad Request.

- [#13092](https://github.com/Kilo-Org/kilocode/pull/13092) [`06fc620`](https://github.com/Kilo-Org/kilocode/commit/06fc620ba01cd725345d4bc457a1acb67a65a820) - Refresh the session UI colors around three tunable roles — session background, code-block background (shared by code blocks, the prompt bubble, and the input), and foreground — and apply them correctly on first paint instead of only after switching themes.

- [#13092](https://github.com/Kilo-Org/kilocode/pull/13092) [`340172a`](https://github.com/Kilo-Org/kilocode/commit/340172af19bff6d31840984da600d4849b6db231) - Use a unified secondary text style for JetBrains session UI labels.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`e5193c5`](https://github.com/Kilo-Org/kilocode/commit/e5193c5493fb9b76e899aee7cb35ad7af9bf637a) - Fix the Agent Manager panel showing a deleted worktree again after switching tabs when the git removal did not actually succeed. Locked worktrees are now marked in the list, the delete dialog asks for explicit confirmation before force-removing a locked worktree, a failed deletion shows a notification with a one-click force-delete retry, and selecting a worktree opens a dedicated worktree session editor tab.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`38e8220`](https://github.com/Kilo-Org/kilocode/commit/38e822042c2fe9ee074f72a4001e8e2852e6ba9c) - Move the JetBrains Agent Manager selection to the neighbouring worktree after deleting the one on screen, instead of jumping unpredictably.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`319d1f4`](https://github.com/Kilo-Org/kilocode/commit/319d1f485917266cc4a56d620c903afa2e96125d) - Improve Agent Manager worktree activity refreshes and keep worktree list filtering responsive.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`15efe98`](https://github.com/Kilo-Org/kilocode/commit/15efe98cb8a36859acbd8aaac31b22d31d94d36e) - Match IntelliJ Project view open and focus behavior for Agent Manager worktrees and sessions.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`916548a`](https://github.com/Kilo-Org/kilocode/commit/916548a8cc55b69f9a9f08341db4569f6f7dcaeb) - Keep JetBrains Agent Manager worktrees in a stable creation order after switching panels or reloading.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`5b0acee`](https://github.com/Kilo-Org/kilocode/commit/5b0acee0167aa333895c611d6681a7ed40f7c777) - Show worktree sessions as deleting while removal is in progress and notify when deletion fails.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`a89936b`](https://github.com/Kilo-Org/kilocode/commit/a89936bf8e197358b8be6ce40a319a75d3478ae1) - Use the shared active list for session history rows with hover-revealed local delete actions.

- [#13092](https://github.com/Kilo-Org/kilocode/pull/13092) [`ff8e470`](https://github.com/Kilo-Org/kilocode/commit/ff8e47030057f6d3191ca4c1c26d374dceb4d8ff) - Always outline JetBrains prompt bubbles and use a rounder prompt bubble shape.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`a417b22`](https://github.com/Kilo-Org/kilocode/commit/a417b220fa75ceef14c2653afff2b227bb78757f) - Polish the JetBrains session prompt background, editor-tab focus ring, and centered jump-to-bottom button alignment.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`f5ff70e`](https://github.com/Kilo-Org/kilocode/commit/f5ff70ea3b26c9eb7994193cb9f8371691bdd73c) - Improve the New Worktree base branch selector with fuzzy matching, default fallback, and validation for unknown branches.

- [#13092](https://github.com/Kilo-Org/kilocode/pull/13092) [`9f1afe1`](https://github.com/Kilo-Org/kilocode/commit/9f1afe1057b0c15f9e123d992a7503d284d544df) - Refine transcript card spacing, plan-ready styling, and diff scrollbar layout, and remove the stray stripe and gap left by empty messages at the top of turns.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`c22ca3a`](https://github.com/Kilo-Org/kilocode/commit/c22ca3ab7bac81b638d1441f5ef52459e287e6c5) - Keep JetBrains chat sessions pinned to the bottom during viewport resizes, expandable view changes, and action dialog reveals when already following the transcript.

- [#13092](https://github.com/Kilo-Org/kilocode/pull/13092) [`706a3c3`](https://github.com/Kilo-Org/kilocode/commit/706a3c3ce74110f2c0433b7a416ee9ddc02770a4) - Keep JetBrains session prompts visible in themes where the panel and editor backgrounds match.

- [#13092](https://github.com/Kilo-Org/kilocode/pull/13092) [`0209c64`](https://github.com/Kilo-Org/kilocode/commit/0209c649fdf918b17b4e578dd70bc38befa5cd24) - Improve JetBrains session card header clicks and align raised content backgrounds with the editor surface.

- [#13092](https://github.com/Kilo-Org/kilocode/pull/13092) [`bf0c6c7`](https://github.com/Kilo-Org/kilocode/commit/bf0c6c7a9ecec955c0b367bcec722b28d00c49d6) - Keep JetBrains session status and copy controls visually bounded to the transcript area.

- [#13215](https://github.com/Kilo-Org/kilocode/pull/13215) [`ae3eb9b`](https://github.com/Kilo-Org/kilocode/commit/ae3eb9b405c4992cc3da9bbcb273e242887ca2ed) - Show the empty session panel for empty JetBrains worktree sessions.

- [#13092](https://github.com/Kilo-Org/kilocode/pull/13092) [`5496466`](https://github.com/Kilo-Org/kilocode/commit/5496466bff9a3a3e1e5cd9b964a1e3d61fb6130e) - Render the JetBrains session backdrop consistently and keep transcript hover backgrounds from getting stuck.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`5ab0ba2`](https://github.com/Kilo-Org/kilocode/commit/5ab0ba24b3934a04ad9dc02b0fc67cc888a34c0c) - Keep the Agent Manager worktree selection in sync with the active editor tab.

- [#12433](https://github.com/Kilo-Org/kilocode/pull/12433) [`89163e7`](https://github.com/Kilo-Org/kilocode/commit/89163e7e02bdf86b4c0f19bc6eba93e08d105afc) - Show Agent Manager worktree sessions with History-style activity badges, relative timestamps, and date sections.

## 7.5.0

### Minor Changes

- [#13015](https://github.com/Kilo-Org/kilocode/pull/13015) [`62923ad`](https://github.com/Kilo-Org/kilocode/commit/62923adb518371d1659ea65e5519768e4abf231b) - Include the active editor file, open files, visible files, and selected text in JetBrains chat context by default, with a Context settings toggle to disable it. Files matched by `.kilocodeignore` (or `.gitignore` plus `.env` files) are excluded, and the default shell is reported to the agent.

- [#12895](https://github.com/Kilo-Org/kilocode/pull/12895) [`a340d61`](https://github.com/Kilo-Org/kilocode/commit/a340d61716b6fdec89943bff438c151b513fd1f3) - Log whether the JetBrains plugin downloads Core or uses the bundled/cached version, and mark the Core version shown in the popup as "Bundled" when it wasn't downloaded.

### Patch Changes

- [#13040](https://github.com/Kilo-Org/kilocode/pull/13040) [`48c4a4a`](https://github.com/Kilo-Org/kilocode/commit/48c4a4af227572011bf44c172ab0ae86e0c2a429) - Ignore negative pricing entries from model catalogs and handle unpriced models gracefully in UI price formatting.

- [#12861](https://github.com/Kilo-Org/kilocode/pull/12861) [`a957cc3`](https://github.com/Kilo-Org/kilocode/commit/a957cc38031823ae923d5bf7cc406543e19124c6) - Avoid GitHub API rate-limit failures when the JetBrains plugin downloads the pinned Kilo CLI.

- [#12869](https://github.com/Kilo-Org/kilocode/pull/12869) [`cee2e36`](https://github.com/Kilo-Org/kilocode/commit/cee2e369f80ac5e8baa949ab7c789dcec831d886) - Fix dropping files into the JetBrains prompt so code files are added as readable file references and drops anywhere in the session panel feed the prompt attachments.

- [#13015](https://github.com/Kilo-Org/kilocode/pull/13015) [`74470aa`](https://github.com/Kilo-Org/kilocode/commit/74470aa8611cdb48e3dc6c2e0deaa027b9af46f9) - Render prompt attachments inside the sent message bubble with file chips, image previews, and selection-aware file opening.

- [#12862](https://github.com/Kilo-Org/kilocode/pull/12862) [`c47cfec`](https://github.com/Kilo-Org/kilocode/commit/c47cfeceebcd6b2ae5c0d416bde00f7e57449df8) - Improve JetBrains session transcript layout, icons, reverted-change summaries, and multi-hunk diff rendering.

- [#12909](https://github.com/Kilo-Org/kilocode/pull/12909) [`5e60473`](https://github.com/Kilo-Org/kilocode/commit/5e60473e768325ce4109ef1c07106e392b49427f) - Improve slash command completion to match separators, camel-case humps, and contained command names.

## 7.4.18

### Patch Changes

- [#12746](https://github.com/Kilo-Org/kilocode/pull/12746) [`1a506a7`](https://github.com/Kilo-Org/kilocode/commit/1a506a712c43d317a5a34b250df16845b641eff8) - Keep the JetBrains prompt send/stop button in sync when attachments are added or removed while a session is busy.

- [#12746](https://github.com/Kilo-Org/kilocode/pull/12746) [`64f0373`](https://github.com/Kilo-Org/kilocode/commit/64f0373056b75546a015816dc0f18b1e380ad93f) - Fix JetBrains diff views to show compact workspace-relative file paths and keep added-file content visible in large branch diffs.

- [#12746](https://github.com/Kilo-Org/kilocode/pull/12746) [`c1f6a75`](https://github.com/Kilo-Org/kilocode/commit/c1f6a75377b438edfc5c3b5dd85ebdc301302e7a) - Fix JetBrains chat transcripts rendering cropped when opening existing sessions.

## 7.5.0

### Minor Changes

- [#12612](https://github.com/Kilo-Org/kilocode/pull/12612) [`a103f4a`](https://github.com/Kilo-Org/kilocode/commit/a103f4abf91c2d3192c11f18d4a56f54b0dafe25) - Improve JetBrains session change tracking: show the files each assistant turn modified with expandable per-file diffs, open inline and branch diffs in a refreshable diff viewer, and surface branch changes in the session header.

## 7.5.0

### Minor Changes

- [#12518](https://github.com/Kilo-Org/kilocode/pull/12518) [`452d0eb`](https://github.com/Kilo-Org/kilocode/commit/452d0eb55f740e951cfd906375e22cf97250144c) - Publish a signed GitHub-hosted JetBrains plugin build with the CLI bundled for offline installation.

### Patch Changes

- [#12571](https://github.com/Kilo-Org/kilocode/pull/12571) [`9950739`](https://github.com/Kilo-Org/kilocode/commit/9950739e36b40a682c0a25173e62f5236e60f81a) - Allow sending prompts while a session is busy and show queued prompts with a remove action.

## 7.4.16

### Patch Changes

- [#12491](https://github.com/Kilo-Org/kilocode/pull/12491) [`2b13e7d`](https://github.com/Kilo-Org/kilocode/commit/2b13e7da2a6a776baeb2d797cd5aaeb07a526c0b) - Improve JetBrains diff previews by hiding hunk headers and adding full-path tooltips to clickable file links.

- [#12491](https://github.com/Kilo-Org/kilocode/pull/12491) [`5c526f1`](https://github.com/Kilo-Org/kilocode/commit/5c526f140b78b13608ad3855532f5215c0b29675) - Render edit tool results with a clickable file target and a highlighted, simplified diff view.

- [#12491](https://github.com/Kilo-Org/kilocode/pull/12491) [`73942c3`](https://github.com/Kilo-Org/kilocode/commit/73942c3f262dda53030d748e6c08f84db2384253) - Open edit tool file links directly when multiple files share the same name.

- [#12491](https://github.com/Kilo-Org/kilocode/pull/12491) [`dd31044`](https://github.com/Kilo-Org/kilocode/commit/dd3104400840e1b4641097bf892e25dfccfd592d) - Render multi-file apply_patch edits as a "Patch" with a file-count tag and one section per file, each showing a clickable filename link and its own changes badge aligned with the diff.

- [#12491](https://github.com/Kilo-Org/kilocode/pull/12491) [`79e606e`](https://github.com/Kilo-Org/kilocode/commit/79e606ebcbb15d20b5fde29d614f07270b1c0b3d) - Smooth out chat scrolling in large JetBrains sessions by only refreshing hover state for the message under the pointer.

- [#12491](https://github.com/Kilo-Org/kilocode/pull/12491) [`95ae0e0`](https://github.com/Kilo-Org/kilocode/commit/95ae0e0b3b066ec5ab60c36b7bcffb973a942872) - Improve chat scrolling performance in large JetBrains sessions.

- [#12491](https://github.com/Kilo-Org/kilocode/pull/12491) [`b2a3a8d`](https://github.com/Kilo-Org/kilocode/commit/b2a3a8dc10d5f579396e1bd76e16a0eef696bede) - Size edit and shell preview popovers to their content with a wider maximum width.

## 7.5.0

### Minor Changes

- [#12437](https://github.com/Kilo-Org/kilocode/pull/12437) [`af33ede`](https://github.com/Kilo-Org/kilocode/commit/af33eded9e4ac1988d218e911b5ff0d4e1b9d8b1) - Add Rules settings for instruction files and Claude Code compatibility. Fix cloud session history import failing with an HTTP 400 error.

- [#12416](https://github.com/Kilo-Org/kilocode/pull/12416) [`a9a9b78`](https://github.com/Kilo-Org/kilocode/commit/a9a9b78b97290e855cda3dd7118a429503802396) - Support viewing, opening, editing, deleting, and configuring JetBrains skill sources.

### Patch Changes

- [#12291](https://github.com/Kilo-Org/kilocode/pull/12291) [`0672375`](https://github.com/Kilo-Org/kilocode/commit/067237564a170e84bc60f42b50bcba99ba9fe0c3) - Improve the JetBrains permission dialog with clearer auto-approve rule actions, hints, and command styling.

- [#12291](https://github.com/Kilo-Org/kilocode/pull/12291) [`e9d0af5`](https://github.com/Kilo-Org/kilocode/commit/e9d0af577359e27728d4b47442d861ac2e5c6e1e) - Honor saved JetBrains bash permission rules when running with isolated dev storage.

## 7.4.12

### Patch Changes

- [#12191](https://github.com/Kilo-Org/kilocode/pull/12191) [`4d676b6`](https://github.com/Kilo-Org/kilocode/commit/4d676b68d2d0dd025c7d1a6684f49f3d03e9d12d) - Use Kilo Core for JetBrains @ file completion.

## 7.4.10

### Patch Changes

- [#12217](https://github.com/Kilo-Org/kilocode/pull/12217) [`d6b36a0`](https://github.com/Kilo-Org/kilocode/commit/d6b36a028cc0a4b7bfd158d75e287c110e2838f7) - Support editing custom OpenAI-compatible providers from JetBrains settings and replace their Disconnect action with Edit and Delete. Added or edited providers stay selected, and the custom provider dialog now closes after a successful save.

- [#12217](https://github.com/Kilo-Org/kilocode/pull/12217) [`6077c1c`](https://github.com/Kilo-Org/kilocode/commit/6077c1c3b36d4c5cd68f206fc146ca472d841c5e) - Fix adding a Custom OpenAI-Compatible Provider silently failing. The dialog now requires at least one model and reports save errors inline so you can correct your input and retry without re-entering the form.

- [#12217](https://github.com/Kilo-Org/kilocode/pull/12217) [`cae3270`](https://github.com/Kilo-Org/kilocode/commit/cae3270c9dacc4097a681539cf3e07cfadceaca7) - Match the model picker Close button styling to JetBrains dialog primary buttons.

- [#12217](https://github.com/Kilo-Org/kilocode/pull/12217) [`cae3270`](https://github.com/Kilo-Org/kilocode/commit/cae3270c9dacc4097a681539cf3e07cfadceaca7) - Use a trash icon for provider delete and show provider edit/delete actions on selection, matching the other settings lists.

## 7.4.6

### Patch Changes

- [#12215](https://github.com/Kilo-Org/kilocode/pull/12215) [`9f9509d`](https://github.com/Kilo-Org/kilocode/commit/9f9509dde55678c5f84b00741dca7f439237b467) - Scale the Kilo session UI with IntelliJ IDE zoom and presentation mode.

- [#12188](https://github.com/Kilo-Org/kilocode/pull/12188) [`349f972`](https://github.com/Kilo-Org/kilocode/commit/349f9723f55662ee4598d933c09264aae575df98) - Migrate legacy v5 markdown to-do lists into populated JetBrains To-dos cards.

- [#12188](https://github.com/Kilo-Org/kilocode/pull/12188) [`048a0ee`](https://github.com/Kilo-Org/kilocode/commit/048a0ee52e8a26930787e3d1fcf41b4a3b5bd57b) - Render tools from imported legacy v5 sessions in assistant turns instead of prompt bubbles.

- [#12188](https://github.com/Kilo-Org/kilocode/pull/12188) [`17b0b22`](https://github.com/Kilo-Org/kilocode/commit/17b0b22d4432276ac314a2bbe9751d52f765dd47) - Import legacy v5 JetBrains settings and sessions through the migration wizard.

- [#12188](https://github.com/Kilo-Org/kilocode/pull/12188) [`8a859e4`](https://github.com/Kilo-Org/kilocode/commit/8a859e49bdd0e15c9a3598945f48dbe1d48bc1b3) - Add a "Later" option to the legacy migration wizard that defers the prompt to the next startup, and stop reporting the language preference as migrated since it cannot be applied in this version.

- [#12214](https://github.com/Kilo-Org/kilocode/pull/12214) [`737993e`](https://github.com/Kilo-Org/kilocode/commit/737993e21c03f89ead970281915eeca5db0349ab) - Honor JetBrains certificate and proxy settings when downloading the CLI and fetching custom provider models.

- [#12180](https://github.com/Kilo-Org/kilocode/pull/12180) [`18e798e`](https://github.com/Kilo-Org/kilocode/commit/18e798e81cd3a6584c6820c9ac710ceac24d0a97) - Use the IntelliJ stop icon for the JetBrains prompt stop button.

- [#12180](https://github.com/Kilo-Org/kilocode/pull/12180) [`de06c40`](https://github.com/Kilo-Org/kilocode/commit/de06c407f91fd8131c6c703386b1684e3cf0e363) - Show elapsed time in the JetBrains progress footer while Kilo is working.

- [#12180](https://github.com/Kilo-Org/kilocode/pull/12180) [`b62105a`](https://github.com/Kilo-Org/kilocode/commit/b62105a6490b268526eca51ff139934f36d0d6b0) - Add a separator before the JetBrains prompt send button.

- [#12180](https://github.com/Kilo-Org/kilocode/pull/12180) [`b62105a`](https://github.com/Kilo-Org/kilocode/commit/b62105a6490b268526eca51ff139934f36d0d6b0) - Match the JetBrains prompt send-button right padding to the bottom padding.

- [#12180](https://github.com/Kilo-Org/kilocode/pull/12180) [`5c98a0d`](https://github.com/Kilo-Org/kilocode/commit/5c98a0d1d407efb06f92496fc66f1c823f12d577) - Fix JetBrains rollback and redo scrolling and align plan custom response font with the prompt input.

- [#12180](https://github.com/Kilo-Org/kilocode/pull/12180) [`18e798e`](https://github.com/Kilo-Org/kilocode/commit/18e798e81cd3a6584c6820c9ac710ceac24d0a97) - Match the JetBrains prompt send icon color to the scroll-to-bottom button across themes.

## 7.4.6

### Patch Changes

- [#12059](https://github.com/Kilo-Org/kilocode/pull/12059) [`42a4966`](https://github.com/Kilo-Org/kilocode/commit/42a49667a946a2f4f22df44b82aa5c3ff11f9aee) - Return keyboard focus to the JetBrains prompt after clicking inline session dialog actions.

- [#12105](https://github.com/Kilo-Org/kilocode/pull/12105) [`8ceeb0f`](https://github.com/Kilo-Org/kilocode/commit/8ceeb0fb990911f5dc4647f7f9d75b26f5ce0ec4) - Stop orphaned Kilo CLI processes when JetBrains IDEs close, including binaries that ignore graceful shutdown.

- [#12059](https://github.com/Kilo-Org/kilocode/pull/12059) [`39cec20`](https://github.com/Kilo-Org/kilocode/commit/39cec2063572368462acd3347bbf588991f366e2) - Refresh the JetBrains prompt input chrome when switching IDE themes.

- [#12059](https://github.com/Kilo-Org/kilocode/pull/12059) [`04a1aa1`](https://github.com/Kilo-Org/kilocode/commit/04a1aa1b123f1b64591786d32fd58a30019fe007) - Polish JetBrains prompt focus and copy toolbar positioning.

- [#12104](https://github.com/Kilo-Org/kilocode/pull/12104) [`c1b206b`](https://github.com/Kilo-Org/kilocode/commit/c1b206b161b8376355fdb2c16a7f4e972e7806fd) - Show rollback/redo progress inline (on the message and redo controls) with a cancel action instead of a full-screen loading overlay.

- [#12059](https://github.com/Kilo-Org/kilocode/pull/12059) [`7e7ab7e`](https://github.com/Kilo-Org/kilocode/commit/7e7ab7e795ca0922f16bfa549d088c23fe631c2f) - Support rollback and redo controls in JetBrains sessions and clarify when reverted changes can be redone.

- [#12059](https://github.com/Kilo-Org/kilocode/pull/12059) [`c1415d2`](https://github.com/Kilo-Org/kilocode/commit/c1415d2879bd7eb38910df43f7593cd641dbd343) - Clarify in JetBrains rollback that only the conversation was reverted when snapshots are disabled.

- [#12059](https://github.com/Kilo-Org/kilocode/pull/12059) [`eb8950c`](https://github.com/Kilo-Org/kilocode/commit/eb8950c1efc3386ebc479c09298187768c6e0cc5) - Polish JetBrains session message toolbar alignment, rollback icon, and copy tooltips.

- [#12059](https://github.com/Kilo-Org/kilocode/pull/12059) [`8ea3f10`](https://github.com/Kilo-Org/kilocode/commit/8ea3f10495e28c8a131b805d51f8f7524895148b) - Increase spacing before non-initial user prompts in the JetBrains session transcript.

## [Unreleased]

## [7.1.0] - 2026-08-26

### Added

- Add the JetBrains Agent Manager beta for creating, opening, organizing, renaming, deleting, and tracking worktree-based tasks and their sessions from the IDE.
- Show Agent Manager worktree activity, changes, ahead/behind, pull request, failure, and attention badges with clearer row actions, menus, tooltips, and drag-and-drop reordering.
- Add New, From PR, and From Branch tabs to the New Worktree dialog for clearer worktree creation and import flows.
- Add JetBrains logging settings with log reveal and backend log download actions for easier diagnostics.
- Add JetBrains workflow settings so workflows can be reviewed and managed from the plugin.
- Show permission-prompt diffs and approval reasons on JetBrains tool cards before acting on tool requests.
- Open sub-agent sessions in JetBrains editor tabs with live collapsed task previews.
- Add Retry to failed JetBrains chat turns so the original request can be rerun without retyping.

### Fixed

- Improve Agent Manager reliability by anchoring worktrees to the main repository storage, pruning stale metadata, hiding dead managed worktrees, refusing unmanaged paths, and preserving session history by worktree.
- Keep failed, stopped, deleted, resumed, and recovered JetBrains sessions represented correctly in chat, session lists, worktree rows, activity badges, and Agents-tab attention dots.
- Detect unsupported JetBrains remote workspaces and missing or moved worktree folders with clearer in-session states instead of ambiguous failures.
- Keep slash completion open and responsive while typing quickly.
- Stabilize JetBrains chat and Agent Manager layout, including header popups, PR badges, row spacing, hover popups, overlays, worktree tab painting, and dialog branch pickers.
- Preserve project-level snapshot disabling across restarts after choosing to disable snapshots from the slow-repo prompt.
- Keep Ask and Plan modes read-only even when broad permission rules are configured.
- Improve Kilo Core reliability for JetBrains by preserving output budgets, recovering reasoning-only incomplete responses, preserving Cerebras completion limits, restoring terminal startup, and removing duplicate skill catalog content from prompts.
- Fix Agent Manager session creation on strict providers and OpenAI Responses API models by allowing nullable tool fields and explicit provider selection.
- Clear empty failed assistant responses when sending a normal follow-up after a provider failure.

### Changed

- Update the pinned Kilo Core CLI used by JetBrains from 7.4.22 to 7.4.23.
- Improve Kilo Core cold and warm startup speed for JetBrains and other clients.
- Show failed-turn details in a clearer error card with the error kind and retry action, while manually stopped turns render as a muted "Stopped" note.
- Put new, imported, or moved Agent Manager worktrees at the top of the list unless manually reordered.
- Make Agent Manager rows visually quieter with regular-weight labels, subdued idle icons, and less stale deleted-session status.
- Remove the experimental agent requirements and task-aware output pruning features from the bundled Kilo Core runtime.
- Remove an unused JetBrains Compose compiler plugin dependency.

## [7.1.0-rc.5] - 2026-08-26

### Added

- Add separate New, From PR, and From Branch tabs to the JetBrains New Worktree dialog, replacing the old import radio buttons with clearer workflows.
- Add Retry to failed JetBrains chat turns so you can roll back the failed response and rerun the original request without retyping it.

### Fixed

- Stop showing error badges and Agents-tab attention dots after you manually stop a turn.
- Keep deleted sessions from briefly reappearing as running, failed, or waiting in session lists and Agent Manager activity badges.
- Prevent the New Worktree dialog from crashing when IntelliJ drops an editable branch picker editor during layout.
- Detect pull requests for imported worktrees more reliably and avoid worktree tab paint artifacts.
- Clear empty failed assistant responses when you send a normal follow-up after a provider failure.

### Changed

- Show failed-turn details in a clearer error card with the error kind and retry action, while stopped turns now render as a simple muted "Stopped" note.

## [7.1.0-rc.4] - 2026-08-25

### Added

- Let Agent Manager tasks choose both provider and model so similarly named models across providers can be selected reliably.
- Show clearer missing-folder states for deleted or moved JetBrains worktrees.

### Fixed

- Keep JetBrains Agent Manager worktrees anchored to the main repository's managed storage, preventing nested worktree data loss when the IDE is opened inside a linked worktree.
- Harden JetBrains worktree cleanup by pruning stale git metadata, hiding dead managed worktrees, refusing unmanaged paths, and blocking parent removal while nested worktrees are live.
- Surface failed JetBrains sessions consistently in worktree and session lists, and keep the Agents attention dot active until the problem is resolved.
- Restore running indicators when resuming sessions instead of leaving stale stopped or error state visible.
- Keep JetBrains session hover popups attached to the correct card, within the visible session area, and hidden behind blocking overlays.
- Keep worktree PR badges clickable after row reuse and layout changes.

### Changed

- Improve Kilo Core startup speed for JetBrains and other clients, especially default TUI launch and short-lived commands.
- Put new, imported, or moved JetBrains Agent Manager worktrees at the top of the list and keep that ordering across reloads unless manually reordered.
- Make JetBrains Agent Manager rows visually quieter with regular-weight labels, subdued idle icons, and pruning of stale deleted-session status.

## [7.1.0-rc.3] - 2026-08-24

### Added

- Add JetBrains logging settings with log reveal and backend log download actions for easier diagnostics.
- Add JetBrains workflow settings so workflows can be reviewed and managed from the plugin.
- Show permission-prompt diffs and approval reasons on JetBrains tool cards before acting on tool requests.
- Open sub-agent sessions in JetBrains editor tabs with live collapsed task previews.
- Improve JetBrains Agent Manager worktrees and chat with worktree branch/PR actions, drag-and-drop reordering, worktree progress, stable activity rows, and session-history scoping.

### Fixed

- Detect unsupported JetBrains remote workspaces and surface the problem in the session instead of failing ambiguously.
- Keep slash completion open and responsive while typing quickly.
- Prevent chat header popups, PR badges, row heights, row spacing, and worktree metadata from drifting out of alignment.
- Keep JetBrains worktree actions visible only when sessions are idle, and enable moving worktrees from local changes.
- Improve Core reliability for JetBrains by preserving output budgets, retrying reasoning-only incomplete responses, sending max-step instructions correctly, preserving Cerebras completion limits, and clarifying background task orchestration.

### Changed

- Bump the pinned Kilo Core CLI used by JetBrains releases to 7.4.23.
- Remove an unused JetBrains Compose compiler plugin dependency.

## [7.1.0-rc.2] - 2026-08-18

### Added

- Add the JetBrains Agent Manager beta for creating, opening, organizing, renaming, and deleting worktree-based tasks and their sessions from the IDE.
- Show worktree activity, change, ahead/behind, and pull request badges in Agent Manager, with clearer row actions, menus, and tooltips.
- Support opening Agent Manager worktrees in new windows and dedicated terminal tabs.

### Fixed

- Improve JetBrains chat readability and scrolling with centered readable width, refreshed prompt chrome, stable tail-follow behavior, and clearer failed-turn outcome cards.
- Unblock JetBrains release verification by replacing internal and override-only IntelliJ API usage with verifier-safe public API paths.
- Keep the migration wizard visible across reconnects and restore worktree session creation after migration completes.
- Show the intended empty session panel for empty persisted sessions instead of a blank transcript.
- Preserve recovered non-idle session states, including pending permission, pending question, retry, and offline states.
- Keep Ask and Plan modes read-only even when broad global permission rules are configured.
- Preserve project-level snapshot disabling across restarts after choosing to disable snapshots from the slow-repo prompt.
- Remove duplicated skill catalog content from Kilo Core prompts to reduce request size while preserving lazy skill loading.

### Changed

- Reuse the session modal layout for the JetBrains migration wizard.

## [7.1.0-rc.1] - 2026-08-18

### Added

- Add the JetBrains Agent Manager beta for creating, opening, organizing, renaming, and deleting worktree-based tasks and their sessions from the IDE.
- Show worktree activity, change, ahead/behind, and pull request badges in Agent Manager, with clearer row actions, menus, and tooltips.
- Support opening Agent Manager worktrees in new windows and dedicated terminal tabs.

### Fixed

- Improve JetBrains chat readability and scrolling with centered readable width, refreshed prompt chrome, stable tail-follow behavior, and clearer failed-turn outcome cards.
- Keep Ask and Plan modes read-only even when broad global permission rules are configured.
- Preserve project-level snapshot disabling across restarts after choosing to disable snapshots from the slow-repo prompt.

### Changed

## [7.0.16] - 2026-08-14

### Added

### Fixed

- Improve JetBrains chat readability with refreshed session surfaces, softer spacing, clearer prompt bubbles, and more consistent hover states.
- Make JetBrains CLI downloads more reliable by retrying transient failures and rate limits, and by avoiding authentication on public CLI asset fetches.

### Changed

- Update the JetBrains plugin CLI pin to Kilo Core 7.4.22.
- Refresh Kilo Core with upstream provider, model variant, and session runtime updates.

## [7.0.15] - 2026-08-10

### Added

- Include editor context in JetBrains prompts, including the active file, open and visible files, selected text, and shell context when available.
- Show selected text and attached files as prompt attachments in user messages, with clickable links back to source files and selections.
- Add a JetBrains Context setting to enable or disable automatic editor context.

### Fixed

- Avoid JetBrains prompt editor crashes during undo/redo bulk updates.
- Keep completed question and tool views in the correct JetBrains transcript position.
- Keep JetBrains chat pinned to the bottom when a turn finishes after modified-file updates.

## [7.0.14] - 2026-08-06

### Fixed

- Improve slash command matching in the JetBrains plugin so typed commands resolve more reliably.
- Avoid startup crashes when the Kilo CLI database is temporarily locked by another process.

## [7.0.13] - 2026-08-05

### Added

- Show the pinned Kilo Core version and whether JetBrains is using a downloaded or bundled CLI build.

### Fixed

- Avoid GitHub checksum API rate limits when JetBrains verifies downloaded Kilo Core CLI assets.
- Add dropped files as JetBrains file references so attachments are available to Kilo reliably.
- Stop eager Kilo Core file watchers when running from JetBrains to reduce unnecessary background work.
- Improve JetBrains session diff rendering, including full-file editor diffs, multi-hunk diffs, fallback handling, gutter line numbers, and session-scoped diff paths.
- Speed up local recall searches in Kilo Core.
- Omit persona details from generated session names.
- Make invalid tool-argument errors clearer and more actionable to the model.
- Handle SQLite lock errors more gracefully.

### Changed

- Bump the JetBrains CLI pin to Kilo CLI v7.4.20.
- Include upstream OpenCode updates through v1.17.13.
- Adopt upstream reasoning variant metadata from OpenCode v1.18.11.

## [7.0.13-rc.1] - 2026-08-05

### Added

- Show the pinned Kilo Core version and whether JetBrains is using a downloaded or bundled CLI build.
- Add JetBrains developer tooling for pinning, unpinning, and updating the bundled Kilo Core CLI used by the plugin.
- Support resuming Claude and Codex sessions through the bundled Kilo Core runtime.
- Add remote CLI file delivery support for attachment flows.

### Fixed

- Avoid GitHub checksum API rate limits when JetBrains verifies downloaded Kilo Core CLI assets.
- Add dropped files as JetBrains file references so attachments are available to Kilo reliably.
- Stop eager Kilo Core file watchers when running from JetBrains to reduce unnecessary background work.
- Improve JetBrains session diff rendering, including full-file editor diffs, multi-hunk diffs, fallback handling, gutter line numbers, and session-scoped diff paths.
- Preserve configured subagent routing in Kilo Core.
- Defer threshold compaction during active tool loops so long-running sessions do not compact at unsafe points.
- Speed up local recall searches in Kilo Core.
- Stop inline skill-shell documentation examples from triggering permission prompts.
- Omit persona details from generated session names.
- Skip Kilo Core startup work for informational commands.
- Make invalid tool-argument errors clearer and more actionable to the model.
- Allow explicit external markdown sources in Kilo Core.
- Handle SQLite lock errors more gracefully.

### Changed

- Bump the JetBrains CLI pin to Kilo CLI v7.4.20.
- Include upstream OpenCode updates through v1.17.13.
- Adopt upstream reasoning variant metadata from OpenCode v1.18.11.

## [7.0.12] - 2026-08-01

### Added

- Support sending another JetBrains prompt while a session is still running. Queued prompts now appear in the conversation and can be removed before Kilo starts processing them.
- Show verbatim skill commands and the skill name in JetBrains permission prompts so approvals are easier to review.
- Add improved session changes and diff review, including branch changes in the session header, richer diff navigation, and full-context file diffs.
- Support executing commands from skill context with batch approval.

### Fixed

- Keep JetBrains permission prompts deterministic, including queued permissions, compacted summaries, escaped skill names, and auto-approve transitions.
- Improve JetBrains diff review reliability by restoring toolbar actions, aligning file headers, bounding branch-diff patch loading, and preserving promoted permissions.
- Improve large branch diff performance by capping huge inline diff previews, compacting diff tree paths, and allowing horizontal scrolling for long file names.
- Reflow existing long chat sessions after they load so transcripts lay out at the correct width without needing to resize the tool window.
- Keep the prompt send/stop button synchronized when attachments are added, removed, or cleared while a session is busy.
- Reduce transcript restyling work during streaming so large sessions remain responsive.
- Prevent CLI agent loops from freezing when a provider stalls after response headers.
- Enforce permissions for shell commands that cannot be scanned by the parser, and fail closed for untrusted or malformed skill command batches.
- Keep session reverts atomic and make snapshot diffs more resilient on Windows.
- Surface provider stream error details more clearly and keep retry handling consistent for rate limits and response stream failures.
- Handle missing nested config unsets and remove unset config keys from layered config files.
- Reduce CLI startup time by deferring Kilo module loading and telemetry work.

### Changed

- Bump the JetBrains CLI pin to Kilo CLI v7.4.17.
- Include upstream OpenCode updates through v1.17.9.

## [7.0.12-rc.4] - 2026-08-01

### Fixed

- Improve large branch diff performance by capping huge inline diff previews, compacting diff tree paths, and allowing horizontal scrolling for long file names.
- Reflow existing long chat sessions after they load so transcripts lay out at the correct width without needing to resize the tool window.
- Keep the prompt send/stop button synchronized when attachments are added, removed, or cleared while a session is busy.
- Reduce transcript restyling work during streaming so large sessions remain responsive.
- Hide expanded diff folder badges and refresh diff tree layout correctly when folders are toggled.

## [7.0.12-rc.3] - 2026-07-31

### Added

- feat(agent-manager): add embedded side-panel terminal destination by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12598
- feat(opencode): route websearch Exa through Kilo proxy by @IamCoder18 in https://github.com/Kilo-Org/kilocode/pull/12470
- feat(agent-manager): reveal jump shortcut badges while modifier is held by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12631
- feat(vscode): add prompt navigator rail to chat transcript by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12632
- feat(agent-manager): support multiple side-panel terminals by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12633
- feat(agent-manager): show worktree name on hover card by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12634
- feat(tui): make Context and Token Usage sidebar sections collapsible by @IamCoder18 in https://github.com/Kilo-Org/kilocode/pull/11986
- feat(tui): register `/auto-approve` slash command for toggling auto-approve mode by @IamCoder18 in https://github.com/Kilo-Org/kilocode/pull/12444
- feat(i18n): mention @ file references in chat input placeholder by @sylwester-liljegren in https://github.com/Kilo-Org/kilocode/pull/11984
- feat(telemetry): include host OS properties by @chrarnoldus in https://github.com/Kilo-Org/kilocode/pull/12641
- feat(vscode): add Persian (Farsi) UI language by @bsflasher in https://github.com/Kilo-Org/kilocode/pull/12424
- feat(agent-manager): add diff scope selector by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12681
- feat(agent-manager): run project scripts in the selected terminal by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12680
- feat: configure web search availability for all providers by @lambertjosh in https://github.com/Kilo-Org/kilocode/pull/12369
- feat(tui): execute cmds in skill context by @bagatao-anaconda in https://github.com/Kilo-Org/kilocode/pull/12604
- feat(vscode): multi-project Agent Manager by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12566
- feat(agent-manager): key diff review by selection with per-session scope by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12709
- feat(agent-manager): run setup scripts in panel terminal by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12703
- feat(vscode): show verbatim skill commands and skill name in permission prompt by @bagatao-anaconda in https://github.com/Kilo-Org/kilocode/pull/12606
- feat(jetbrains): show verbatim skill commands and skill name in permission prompt by @bagatao-anaconda in https://github.com/Kilo-Org/kilocode/pull/12724
- feat(jetbrains): improve session changes and diff review by @kirillk in https://github.com/Kilo-Org/kilocode/pull/12612

### Fixed

- fix(cli): enforce permissions on shell commands the parser fails to scan by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12585
- fix(ci): docs-sync bot — no errors, no timeouts, no lost PRs by @iscekic in https://github.com/Kilo-Org/kilocode/pull/12580
- fix(cli): prevent agent-loop freeze when a provider stalls after headers by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12588
- fix(cli): keep session reverts atomic by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12587
- fix(vscode): avoid eager worktree watchers by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12593
- fix(nix): use the required Bun version for builds by @noobezlol in https://github.com/Kilo-Org/kilocode/pull/12592
- fix(vscode): show prompt input toggle tooltips instantly by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12591
- fix: make snapshot diffs resilient on Windows by @noobezlol in https://github.com/Kilo-Org/kilocode/pull/12583
- fix(cli): include credentials in console URLs printed for headless users by @IamCoder18 in https://github.com/Kilo-Org/kilocode/pull/12333
- fix(vscode): make message copy buttons reliable by @mjnaderi in https://github.com/Kilo-Org/kilocode/pull/12123
- fix(ci): authenticate JetBrains OpenAPI codegen GitHub API calls by @kirillk in https://github.com/Kilo-Org/kilocode/pull/12603
- fix(agent-manager): keep terminal destination consistent across windows by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12629
- fix(vscode): speed up embedded terminal startup and fix cold-connection race by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12630
- fix(cli): exclude gpt-5.6 from ChatGPT subscriptions by @chrarnoldus in https://github.com/Kilo-Org/kilocode/pull/12601
- fix(vscode): stop flashing interruption warning on queued follow-up handoff by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12639
- fix(cli): promote stable releases to rc by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12647
- fix(agent-manager): keep terminal cursor visible by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12658
- fix(ci): docs-sync bot passes --auto, drains its backlog, and reports readable causes; fix(cli): honest exit codes for headless runs by @iscekic in https://github.com/Kilo-Org/kilocode/pull/12605
- fix(vscode): persist MCP server toggle state by @Hardik180704 in https://github.com/Kilo-Org/kilocode/pull/12624
- fix(vscode): improve long-session prompt navigation by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12656
- fix(cli): remove unset config keys from every layered config file by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12687
- fix(cli): reduce startup time by deferring Kilo module loading and telemetry work by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12682
- fix(agent-manager): make Cmd+/ terminal toggle reliable and sidebar-safe by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12691
- fix(vscode): list past chats across the worktree family by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12692
- fix(core): include underlying reason in ripgrep execution failures by @chrarnoldus in https://github.com/Kilo-Org/kilocode/pull/12684
- fix(agent-manager): open terminal when switching worktrees by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12689
- fix(agent-manager): align panel terminal tabs with session tabs by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12693
- fix(agent-manager): propagate base branch override to active diff source by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12696
- fix(agent-manager): align Cmd+/ fallback with platform binding and one-shot echo by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12694
- fix(cli): settle signal-terminated shell commands as 128 + signum by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12698
- fix(memory): accept extra digest fields by @Hardik180704 in https://github.com/Kilo-Org/kilocode/pull/12675
- fix: surface provider error details from Responses API stream failures by @chrarnoldus in https://github.com/Kilo-Org/kilocode/pull/12700
- fix(docs-sync): intercept revert PRs and calibrate prompts by @iscekic in https://github.com/Kilo-Org/kilocode/pull/12708
- fix(vscode): restore Agent Manager terminals by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12720
- fix(agent-manager): keep detail pane for unassigned sessions by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12722
- fix(cli): stabilize Windows CI tests and rebalance slow shards by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12723
- fix(cli): handle missing nested config unsets by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12727
- fix(indexing): improvements to semantic_search tool description by @shssoichiro in https://github.com/Kilo-Org/kilocode/pull/12227
- fix(vscode): make cache hit rate write-aware by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12738
- fix(cli): suppress AI SDK system message warning in TUI by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12739

### Changed

- release(jetbrains): v7.0.12-rc.2 by @kilo-maintainer[bot] in https://github.com/Kilo-Org/kilocode/pull/12581
- chore(opencode): merge v1.17.6 through v1.17.9 by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12460
- refactor(vscode): remove dead code from Agent Manager by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12594
- refactor(vscode): remove unused webview context APIs and orphaned CSS by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12596
- chore(vscode): remove unused translation keys by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12602
- refactor(vscode): extract apply-to-local and worktree diff workflows out of AgentManagerApp by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12636
- refactor(agent-manager): namespace terminal keys by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12635
- refactor(vscode): share webview provider shell by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12648
- refactor(agent-manager): consolidate import transaction by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12651
- refactor(vscode): deduplicate config snapshots by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12650
- chore(jetbrains): centralize test dependency versions by @hdcodedev in https://github.com/Kilo-Org/kilocode/pull/12608
- docs(kilo-docs): add documentation for referencing past chats via @ mentions by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12662
- docs: document Shift+Tab shortcut for cycling reasoning effort variants by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12661
- docs(kilo-docs): mention JetBrains in auto-approve settings by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12669
- docs(kilo-docs): document JetBrains plugin settings by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12668
- docs: document mobile app remote sessions, PR review, and session cost by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12667
- docs(checkpoints): document revert banner warnings and snapshot restoration by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12663
- Update the Cerebras provider example by @ryanl-cerebras in https://github.com/Kilo-Org/kilocode/pull/12620
- docs(agent-manager): document session overview, prompt, and stop by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12660
- refactor(cli): remove provably unused kilocode code by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12599
- docs: add Mixlayer provider page by @sodiumsun in https://github.com/Kilo-Org/kilocode/pull/12500
- docs(kilo-docs): document kilo cloud CLI usage and skill archives by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12664
- docs: add NVIDIA to BYOK providers by @lambertjosh in https://github.com/Kilo-Org/kilocode/pull/12576
- chore(jetbrains): bump CLI pin to v7.4.17 by @kilo-maintainer[bot] in https://github.com/Kilo-Org/kilocode/pull/12644
- docs(cli): deprecate Kilo Console by @lambertjosh in https://github.com/Kilo-Org/kilocode/pull/12701

## [7.0.12-rc.2] - 2026-07-27

### Added

### Fixed

- Fix the GitHub-hosted bundled JetBrains plugin build so signing uses certificate and private-key files during verification.

### Changed

## [7.0.12-rc.1] - 2026-07-27

### Added

- Support sending another JetBrains prompt while a session is still running. Queued prompts now appear in the conversation and can be removed before Kilo starts processing them.

## [7.0.11] - 2026-07-27

### Added

- Add a signed GitHub-hosted bundled JetBrains plugin build that includes the Kilo CLI for offline or restricted-network installs.

### Fixed

- Load global skills reliably from JetBrains projects that are not inside a Git repository.
- Support adaptive thinking for Claude Opus and Sonnet 5+ model identifiers across Anthropic, AI Gateway, and Bedrock providers.
- Flush pending cloud session updates when the Kilo Core runtime shuts down, reducing cases where the final assistant message is missing when a session is reopened elsewhere.
- Prune stale bundled CLI versions after upgrading bundled JetBrains installs.

### Changed

- Update the JetBrains CLI pin from Kilo Core 7.4.15 to 7.4.16.

## [7.0.10] - 2026-07-24

## [7.0.10] - 2026-07-24

### Added

- Render edit, write, and apply-patch tool results as expandable diff previews with clickable file links, change counts, syntax-highlighted diffs, and clearer multi-file patch sections.

### Fixed

- Improve session performance for large transcripts.
- Fix Kilo Core failures caused by strict OpenAI-compatible compaction requests, unexpected provider finish reasons, read-only database files at startup, AWS profile credentials, and config files being rewritten just by reading them.

### Changed

- Update the JetBrains CLI pin from Kilo Core 7.4.13 to 7.4.15.

## [7.0.9] - 2026-07-21

### Added

- Add a Rules settings page under Agent Behavior for managing instruction files and Claude Code compatibility.

### Fixed

- Restore importing cloud-only session history by updating the JetBrains CLI pin to Kilo Core 7.4.13.

### Changed

- Improve xAI prompt cache usage in Kilo Core for better cache hit rates.

## [7.0.8] - 2026-07-21

### Added

- Add settings for context controls, including context mentions and ignore patterns.
- Add settings for skills, including editing local skills and viewing remote skills as read-only.
- Add auto-approve settings for permission rules, with filters and wildcard labels.
- Use Kilo Core for JetBrains file mention search so @-mentions match CLI indexing behavior.

### Fixed

### Changed

- Update the JetBrains CLI pin from Kilo Core 7.4.5 to 7.4.11.

## [7.0.7] - 2026-07-15

### Added

- Add support for OpenAI-compatible custom providers.

### Fixed

- Improve custom provider setup by validating required fields and showing configuration errors in the dialog.
- Close the custom provider dialog correctly after adding a provider.
- Clean up deleted custom providers by using the disconnect flow.

### Changed

- Keep the JetBrains plugin pinned to Kilo Core 7.4.5 for this release.

## [7.0.6] - 2026-07-14

### Fixed

- Honor the IDE's certificate and proxy settings for outbound HTTPS requests.
- Scale the session UI correctly with IDE zoom, fixing double-scaled heights and extra empty space in the transcript and prompt composer.

## [7.0.5] - 2026-07-14

### Added

- Add an elapsed-time indicator to the session progress footer so long-running tasks show how long they have been active.
- Support importing legacy JetBrains v5 data directly from raw storage when the previous consolidated migration file is unavailable.

### Fixed

- Restore the v5 migration wizard for users whose legacy provider, OAuth, MCP, mode, setting, or session data was not detected during upgrade.
- Improve migration reliability by preserving checklist todos, importing legacy tool calls as assistant parts, validating raw session IDs, and reducing migration memory usage.
- Polish session controls with more native prompt icons, progress footer spacing, auto-hiding prompt scrollbars, and improved rollback/redo scrolling.

### Changed

- Keep the JetBrains plugin pinned to Kilo Core 7.4.5 for this release.

## [7.0.4] - 2026-07-10

### Fixed

- Stop orphaned Kilo Core processes on Windows so closing the IDE no longer leaves a lingering `kilo serve` process or blocks the next IDE launch.
- Improve JetBrains CLI shutdown ordering so app close kills the process tree before closing streams, preventing Windows shutdown deadlocks.

## [7.0.3] - 2026-07-10

### Added

- Add rollback redo controls in JetBrains sessions so reverted changes can be restored from the chat UI.
- Add inline revert progress in JetBrains sessions, including localized status text and safer cancellation handling.
- Add Kilo Core support for localized commit-message generation, AI image generation, large bash-output pruning, and improved model-usage display.

### Fixed

- Harden Kilo Core startup and shutdown so startup failures show clearer diagnostics, app close stops the CLI process, and lingering child processes are cleaned up more reliably.
- Fix workspace reload recovery so stale reload state no longer disrupts the session connection.
- Fix JetBrains rollback and revert flows so prompt focus, scroll state, diff order, and turn state are preserved more reliably.
- Fix Kilo Core Bedrock SSO credential resolution and commit-message error handling when no changes are available.

### Changed

- Update the JetBrains plugin to download Kilo Core 7.4.5.

## [Unreleased]

## [7.0.2] - 2026-07-07

### Added

- First GA release of the native Kilo extension for JetBrains IDEs.
- Download the pinned Kilo Core release at runtime instead of bundling CLI binaries, keeping the JetBrains plugin smaller while verifying downloaded archives before use.
- Show Kilo Core runtime details from the JetBrains plugin so users can see which Core release is active.

### Fixed

- Improve JetBrains runtime CLI download reliability by pruning stale binaries, using the shell environment for PATH resolution, and surfacing exact release-resolution failures.

### Changed

- Polish JetBrains chat UI with auto-collapsing reasoning previews, clearer retry/offline footer state, and more balanced prompt, code, question, todo, history, and popup spacing.
- Show the active routed model name and remote status more consistently in CLI runtime surfaces.

## [7.0.2-rc.2] - 2026-07-07

### Added

- Show compact previews for collapsed reasoning blocks so long assistant reasoning stays readable without taking over the transcript.
- Add clearer Kilo Core runtime information and diagnostics for release download failures.

### Fixed

- Resolve the CLI executable using the user's shell environment so custom PATH setups work when sessions start from JetBrains.
- Keep retry and offline status visible in the session footer while preserving transcript context.
- Prevent oversized header popups by capping preview content.

### Changed

- Download the required Kilo Core release at runtime and prune stale cached runtime binaries automatically.
- Polish JetBrains chat spacing, prompt input behavior, question/todo layout, history scrolling, code block padding, and session background colors.

## [7.0.2-rc.1] - 2026-07-07

### Added

- Download the pinned Kilo Core release at runtime instead of bundling every CLI binary in the JetBrains plugin, keeping the Marketplace package smaller while still verifying downloaded artifacts.

## [7.0.1] - 2026-07-06

### Added

- Launch the first public Kilo JetBrains release with native JetBrains sessions and remote development support.

## [7.0.1-rc.15] - 2026-07-06

### Fixed

- Improve transcript rendering, prompt focus styling, settings clicks, and prompt picker interactions.

## [7.0.1-rc.14] - 2026-07-02

### Added

- Add Agent Behavior settings
- Show richer model picker details, including routed model information and clearer model badges.
- Show Kilo Pass usage, bonus credits, renewal dates, and top-up actions in the JetBrains user profile.

### Fixed

- Recover backend startup more reliably when event streams stall, reconnect, or are interrupted by stale failures.
- Resolve workspaces by project ID to avoid cross-project session confusion.
- Improve CLI recovery, config paths, and `.kilo` config directory handling.

## [7.0.1-rc.13] - 2026-06-23

### Added

- Add slash command and file mention completion in the prompt.
- Add support for clickable and explainable `@file` mentions in the prompt.

### Fixed

- Fix prompt undo/redo behavior and restore prompt focus after history navigation.
- Fix lazy session creation to avoid duplicate initialization.
- Fix prompt-training model disclosure.

### Changed

- Update the bundled CLI to include upstream OpenCode 1.15.13 changes.

## [7.0.1-rc.12] - 2026-06-18

### Added

- Provider settings management, including searchable provider lists, API-key configuration, OAuth provider login, provider enable/disable controls, disconnect actions, and shared provider metadata.
- Add copy controls to session messages so prompts and assistant responses can be copied directly from the transcript.
- Share codebase indexes across worktrees so Agent Manager and worktree sessions can use semantic search without duplicating the full index.

### Fixed

- Keep long JetBrains prompt input usable by capping growth, preserving scrolling, and hiding soft-wrap glyphs.
- Copy actions correctly in session.

### Changed

- Update the bundled CLI runtime to OpenCode 1.15.9

## [7.0.1-rc.11] - 2026-06-17

### Added

- Provider settings management, including provider catalog sections, provider descriptions, provider settings actions, disconnect flows, provider auth handling, and provider/model picker improvements.
- Session copy controls for chat messages.

### Fixed

- Cap JetBrains prompt input growth and hide soft wrap glyphs in the prompt field.
- Keep JetBrains provider toolbars and authentication overlays fixed, and improve provider API key dialog sizing.
- Clean up restartless unload behavior.
- Silence interrupted session notifications across clients.
- Always deny tool calls for system agents.

## [7.0.1-rc.10] - 2026-06-17

### Added

- Provider settings management, including provider catalog sections, provider descriptions, provider settings actions, disconnect flows, provider auth handling, and provider/model picker improvements.
- Session copy controls for chat messages.

### Fixed

- Cap JetBrains prompt input growth and hide soft wrap glyphs in the prompt field.
- Keep JetBrains provider toolbars and authentication overlays fixed, and improve provider API key dialog sizing.
- Clean up restartless unload behavior.
- Silence interrupted session notifications across clients.
- Always deny tool calls for system agents.

## [7.0.1-rc.9] - 2026-06-15

### Added

- Add prompt enhancement support.
- Support prompt and transcript attachments, including paste, drop, preview, and editor tab opening flows.

### Fixed

- Improve shell and markdown rendering, including code block spacing, terminal block retention, shell command highlighting, and session layout polish.

## [7.0.1-rc.8] - 2026-06-09

### Added

- Display search results and tool output in clearer, more readable JetBrains session cards.

### Fixed

- Improve session transcript scrolling so streaming updates, expanded cards, reasoning blocks, and mouse wheel scrolling preserve the user's position more reliably.
- Make session transcripts easier to scan with tighter spacing, aligned icons, cleaner card outlines, relative search paths, and less visual noise.
- Keep completed reasoning blocks expanded after a response finishes.
- Improve session stability during long-running or cancelled prompts.
- Restore automatic session titles, project skill discovery, and subagent isolation in forked sessions.
- Restore imported cloud session diffs.
- Compact sessions before the configured context limit is exceeded.

### Changed

- Update the bundled Kilo CLI runtime with the latest fixes used by the JetBrains plugin.

## [7.0.1-rc.7] - 2026-06-04

### Fixed

- Fixed JetBrains release notes rendering so notes from multiple releases display correctly.

## [7.0.1-rc.6] - 2026-06-03

### Fixed

- Model picker now highlights models that can be used for training.

## [7.0.1-rc.5] - 2026-06-03

### Added

- Added Feedback & Support entry points to the empty session screen
- Model and configuration settings, including config file shortcuts and separate CLI restart and reinstall actions.

### Fixed

- Prevented stale backend events from affecting sessions after a restart.
- Improved chat code blocks and made long or streaming session transcripts faster and more stable.

## [7.0.1-rc.4] - 2026-05-29

### Added

- Initial JetBrains plugin release with a native Kilo Code tool window.
- Chat sessions with streamed responses, tool output, reasoning, markdown, todos, and plan follow-ups.
- Native mode/model selection, account sign-in, permission prompts, and question flows.
- Local and cloud session history with search, reopen, rename/delete local sessions, and repository filtering.
- Migration wizard for legacy JetBrains plugin settings and chat history.
- Bundled Kilo CLI runtime for macOS, Linux, and Windows.
