# Contributing to Kilo Code

> **Note**: New versions of the VS Code extension and CLI are being developed in [Kilo-Org/Kilo](https://github.com/Kilo-Org/Kilo) (extension at `packages/kilo-vscode`, CLI at `packages/opencode`). If you're looking to contribute to the extension or CLI, please head over to that repository.

First off, thanks for taking the time to contribute! ❤️

All types of contributions are encouraged and valued. See the [Table of Contents](#table-of-contents) for different ways to help and details about how this project handles them. Please make sure to read the relevant section before making your contribution. It will make it a lot easier for the team and smooth out the experience for all involved. The community looks forward to your contributions. 🎉

If you don't have time to contribute, that's fine. There are other easy ways to support the project and show your appreciation, which we would also be very happy about:

- Star the project
- Post on X or Linkedin about Kilo Code `#kilocode
- Mention the project at local meetups and tell your friends/colleagues

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [I Have a Question](#i-have-a-question)
- [I Want To Contribute](#i-want-to-contribute)
    - [Code Contributors](#code-contributors)
    - [Reporting Bugs](#reporting-bugs)
    - [Custom Modes](#custom-modes)
    - [Feature Requests](#feature-requests)
    - [Improving The Documentation](#improving-the-documentation)
    - [Improving The Design](#improving-the-design)
    - [Publish a Blog Post or Case Study](#publish-a-blog-post-or-case-study)
    - [Commit Messages](#commit-messages)
- [Pull requests](#pull-requests)

## Code of Conduct

This project and everyone participating in it is governed by the [Code of Conduct](https://github.com/Kilo-Org/kilocode/blob/main/CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior
to [hi@kilocode.ai](mailto:hi@kilocode.ai).

## I Have a Question

If you need clarification after reading this document, we encourage you to join our [discord](https://kilo.ai/discord) workspace and join channels [kilo-dev-contributors](https://discord.com/channels/1349288496988160052/1391109167275577464) and [extensions-support channel](https://discord.com/channels/1349288496988160052/1349358641295265864).

## I Want To Contribute

### Code Contributors

We’re excited that you’re interested in contributing code to Kilo Code! Before you start, please take a look at our [Development Guide](https://github.com/Kilo-Org/kilocode/blob/main/DEVELOPMENT.md), it includes setup instructions, build steps, and details on running tests locally.

#### What to Expect

- A GUI-based change with settings may involve 12–13 files, plus about 18 more for internationalization (i18n).

- A new feature or major update might also require corresponding tests, translations, and settings configuration updates.

Don’t let that scare you off, we just want you to have a realistic idea of what’s involved before diving in. You’ll learn a lot, and we’re here to help if you get stuck.

#### Tips Before You Start

- If your change affects any UI elements or Settings, expect it to touch multiple files and translations.

- You can use our translation workflow to automate adding i18n strings instead of editing each language manually.

Unsure if your contribution is “small” or “large”? Start a quick discussion in [kilo-dev-contributors](https://discord.com/channels/1349288496988160052/1391109167275577464) channel on discord or open an issue with good context, follow the commit and pull request guidelines below once you’re ready to open a PR.

### Reporting Bugs

Please use our issues templates that provide hints on what information we need to help you.

> You must never report security related issues, vulnerabilities or bugs including sensitive information to the issue tracker, or elsewhere in public. Instead sensitive bugs must be sent by email to [hi@kilocode.ai](mailto:hi@kilocode.ai).

### Custom Modes

Custom modes are a powerful way to extend Kilo Code's capabilities. To create and share a custom mode:

- Follow the [Custom Modes documentation](https://kilo.ai/docs/customize/custom-modes) to create your mode.

- Test your mode thoroughly

- Share your mode with the community on [Reddit](https://www.reddit.com/r/kilocode/) or you can show off / start a discussion on [show-off-your-builds](https://discord.com/channels/1349288496988160052/1375399779760214037) or [workflows-and-integration](https://discord.com/channels/1349288496988160052/1420236932780130418) on discord.

### Feature Requests

Suggest feature requests in [Discussion](https://github.com/Kilo-Org/kilocode/discussions), only open an [Issue](https://github.com/Kilo-Org/kilocode/issues/new/choose) for reporting a bug or actual contributions. Don't open issues for questions or support, instead join our [Discord workspace](https://kilo.ai/discord) and ask there.

- Provide as much context as you can about what you're running into.

### Improving The Documentation

If you notice outdated information or areas that could be clarified, kindly start a discussion in the [general](https://discord.com/channels/1349288496988160052/1349288496988160055) channel on discord.
Please note that the main [documentation](https://github.com/Kilo-Org/docs) repository has been archived, you can still view it for reference.

### Improving The Design

Design contributions are welcome! To ensure smooth collaboration, please use the Design Improvement Template when opening a design-related issue.
This helps us gather the right context (such as wireframes, mockups, or visual references) and maintain a consistent design language across the project. Feedback and iterations are highly encouraged, design is always a shared process.

### Publish a Blog Post or Case Study

We love hearing how people use or extend Kilo Code in their own projects. If you’ve written about your experience, we’re happy to review it!
Our blog and case study repository has been archived, you can still access it [here](https://github.com/Kilo-Org/docs/tree/main/blog-posts) for reference. To share your work, please start a discussion in the [general](https://discord.com/channels/1349288496988160052/1349288496988160055) channel on discord, summarizing your post or case study, with a link to the full content.

### Commit Messages

Writing clear and consistent commit messages helps maintainers understand the purpose of your changes. A good commit message should:

- Be written in the present tense (e.g., Add new feature, not Added new feature)

- Be short (50 characters or less for the summary line)

- Include additional context in the body if needed

- Reference related issue numbers (e.g., Fixes `#123)

- Keep each commit focused on one logical change

## Pull Requests

When you’re ready to contribute your changes, follow these steps to create a clear and reviewable pull request:

- Push your changes to your fork:

    ```bash
    git push origin your-branch-name
    ```

- Open a Pull Request against the main Kilo Code repository.

- Select "Compare across forks" and choose your fork and branch.

- Fill out the PR template with:

- A clear description of your changes

    - Any related issues (e.g., “Fixes `#123”)

    - Testing steps or screenshots (if applicable)

    - Notes for reviewers, if special attention is needed

For more context, kindly read the official [contributing docs](https://kilo.ai/docs/contributing).

Your contributions, big or small help make Kilo Code better for everyone!🫶

## References

This document was adapted from [https://contributing.md](https://contributing.md/)!
