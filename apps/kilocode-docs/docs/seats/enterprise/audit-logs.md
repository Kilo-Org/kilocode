---
sidebar_label: Audit Logs
---

# Audit Logs

Audit Logs record key actions that occur within your organization, including user activity, workspace changes, and model or settings updates.
Admins can search and filter logs to review access patterns and ensure compliance.

## Viewing Audit Logs

Only **Admins** and **Owners** can view and filter through logs.

Go to **Enterprise Dashboard → Audit Logs** to view a searchable history of all organization events.
Use filters to narrow down results by action, user, or date range.

<img width="900" height="551" alt="Audit-log-dashboard" src="https://github.com/user-attachments/assets/41fcf43f-4a47-4f47-a3d9-02d20a6427a6" />


## Filters

| Filter               | Description                                                                                                                                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actions**          | Choose one or more events to view. Options include: <br> - `user login` / `logout` <br> - `user invite`, `accept invite`, `revoke invite` <br> - `settings change` <br> - `purchase credits` <br> - `member remove`, `member change role` <br> - `sso set domain`, `sso remove domain` |
| **Actor Email**      | Filter by the user who performed the action.                                                                                                                                                                                                                                           |
| **Start / End Date** | Specify a date and time range to view logs within that period.                                                                                                                                                                                                                         |

Multiple filters can be used together for precise auditing.


## Log Details

Each event includes:

| Field       | Description                                                                     |
| ----------- | ------------------------------------------------------------------------------- |
| **Time**    | When the action occurred (shown in your local timezone).                        |
| **Action**  | The event type (e.g. `user.login`, `settings.change`).                          |
| **Actor**   | The user who performed the action.                                              |
| **Details** | Context or additional data related to the event (e.g. models added or removed). |
