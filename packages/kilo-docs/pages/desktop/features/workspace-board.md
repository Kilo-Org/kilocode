---
title: "Workspace board"
description: "Sort your sessions into columns you name, such as Backlog, In progress, Review, and Done, and follow them on a board in Kilo Desktop."
---

# Workspace board

The workspace board shows your sessions as cards in columns you name, so you can see where each piece of work stands. It's another view of the sessions in your sidebar: the same sessions, with the same live status and pull request badges, laid out on a board.

## Open the board

Select **Show Workspace Board** at the top of the session list in the sidebar, next to **Session list options**. The board takes the place of the open session. Select **Hide Workspace Board** to go back to your session.

### Pop out the board

Select {% svgIcon src="/docs/img/desktop/external-link.svg" /%} **Pop out** in the board's header to open it in its own window, sized to show every column. In the main window, the board's place shows *This view is open in a separate window.* with **Bring to front** and **Dock**, and the sidebar button reads **Bring Workspace Board to front**.

The popped-out board works like the board in the main window. Opening a session from a card opens it in the main window and brings that window forward. Select **Dock** in the board window's header to put the board back in the main window.

## Columns

A new board starts with four columns: **Backlog**, **In progress**, **Review**, and **Done**. Each column shows how many cards it holds. Columns are only labels: a session's column doesn't change anything about the session itself.

- **Add a column** — select {% svgIcon src="/docs/img/desktop/plus.svg" /%} **Add column** in the board's header. Kilo Desktop adds a **New column** at the end and opens its name for editing. A board can have up to 20 columns.
- **Rename a column** — double-click its name, or choose **Rename** from its {% svgIcon src="/docs/img/desktop/ellipsis.svg" /%} menu. Press Enter to save or Esc to cancel. Names can be up to 40 characters.
- **Reorder columns** — drag a column by its header, or choose **Move left** or **Move right** from its menu.
- **Delete a column** — choose **Delete** from its menu. If the column has cards, Kilo Desktop asks **Delete *column*?** and moves its cards to the next column (or the previous one, for the last column). Select **Delete column** to confirm. The sessions themselves aren't deleted. A board always keeps at least one column.

## Cards

Each card is one session. A card shows:

- The session's title and live status icon. Archived sessions keep their card, with the title dimmed.
- Its status, such as **Working**, **Requires input**, **Requires approval**, **Unread**, **Idle**, or **Archived**.
- The session's pull request badge (**#N**, colored by the pull request's state), when it has one.
- When it was last updated.

Hover a card to see its workspace.

## Add and move sessions

To put a session on the board, drag it from the session list onto a column. You can also open the session's {% svgIcon src="/docs/img/desktop/ellipsis.svg" /%} menu (or right-click it) and choose **Add to board**, then a column. Each session can be on the board only once.

To move a card, drag it to another column or to a different place in the same column, or choose **Move on board** from its menu and pick a column. An empty column shows **Drop sessions here**.

To take a session off the board, choose **Remove from board** from its menu. This removes only the card; the session stays in your sidebar. When you delete a session, its card is removed from the board too.

## Work with a card

- **Open the session** — select the card. The board closes and the session opens.
- **Open the pull request** — select the card's pull request badge to open the pull request in your browser.
- **Use the session menu** — hover the card and select {% svgIcon src="/docs/img/desktop/ellipsis.svg" /%} for the same actions as the session list: **Pin** or **Unpin**, **Rename**, **Archive** or **Restore**, **Move on board**, **Remove from board**, and **Delete**.

## Filter by workspace

The board follows the **Workspace filter** in the sidebar. Choose **All workspaces** to see every card, **No workspace** for sessions that aren't in a workspace, or a single workspace to see only its sessions. Cards from other workspaces are hidden, not removed.

## Clear the board

To start fresh, select **Clear board** in the board's header. Kilo Desktop asks **Clear the board?** and tells you how many sessions it takes off, including cards hidden by the workspace filter. Select **Clear board** to confirm. Your columns and the sessions themselves are kept.

## Where the board is saved

There's one board on each device, with its columns and every card from every workspace. Kilo Desktop keeps it across restarts. The board isn't synced to your other devices.
