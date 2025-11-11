---
sidebar_label: À TRADUIRE: Audit Logs (Enterprise Only)
---

# À TRADUIRE: Audit Logs (Enterprise Only)

À TRADUIRE: Audit Logs record key actions that occur in the management of your Kilo seats, including user logins, adding or removing models, providers, and modes, and role changes.

À TRADUIRE: Owners and Admins can search and filter logs to review access patterns and ensure compliance.

## À TRADUIRE: Viewing Audit Logs

À TRADUIRE: Only **À TRADUIRE: Owners** can view and filter through logs.

À TRADUIRE: Go to **À TRADUIRE: Enterprise Dashboard → Audit Logs** to view a searchable history of all organization events.
À TRADUIRE: Use filters to narrow down results by action, user, or date range.

<img width="900" height="551" alt="À TRADUIRE: Audit-log-dashboard" src="https://github.com/user-attachments/assets/41fcf43f-4a47-4f47-a3d9-02d20a6427a6" />

## À TRADUIRE: Filters

| À TRADUIRE: Filter               | À TRADUIRE: Description                                                                                                                                                                                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **À TRADUIRE: Actions**          | À TRADUIRE: Choose one or more events to view. Options include: <br /> - `user login` / `logout` <br /> - `user invite`, `accept invite`, `revoke invite` <br /> - `settings change` <br /> - `purchase credits` <br /> - `member remove`, `member change role` <br /> - `sso set domain`, `sso remove domain` |
| **À TRADUIRE: Actor Email**      | À TRADUIRE: Filter by the user who performed the action.                                                                                                                                                                                                                                                       |
| **À TRADUIRE: Start / End Date** | À TRADUIRE: Specify a date and time range to view logs within that period.                                                                                                                                                                                                                                     |

À TRADUIRE: Multiple filters can be used together for precise auditing.

## À TRADUIRE: Log Details

À TRADUIRE: Each event includes:

| À TRADUIRE: Field       | À TRADUIRE: Description                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| **À TRADUIRE: Time**    | À TRADUIRE: When the action occurred (shown in your local timezone).                        |
| **À TRADUIRE: Action**  | À TRADUIRE: The event type (e.g. `user.login`, `settings.change`).                          |
| **À TRADUIRE: Actor**   | À TRADUIRE: The user who performed the action.                                              |
| **À TRADUIRE: Details** | À TRADUIRE: Context or additional data related to the event (e.g. models added or removed). |

## À TRADUIRE: Logged Events

À TRADUIRE: Here is the list of all events included in the Kilo Code audit logs:

- À TRADUIRE: Organization: Create, Settings Change, Purchase Credits
- À TRADUIRE: Organization Member: Remove, Change Role
- À TRADUIRE: User: Login, Logout, Accept Invite, Send Invite, Revoke Invite
- [À TRADUIRE: Custom Modes](/plans/custom-modes): À TRADUIRE: Create, Update, Delete
- [À TRADUIRE: SSO](/plans/enterprise/SSO) (À TRADUIRE: Enterprise Only): À TRADUIRE: Auto Provision, Set Domain, Remove Domain
