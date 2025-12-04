# Why I Let AI Write My Commit Messages

### And Probably You Should Too

I've just finished implementing a big feature, the code is staged and ready to go, but there I am — mesmerized by the empty commit message field, brain is blank. What do I write? "Fixed stuff"? "Updates"? "asdf"? Do you know that feeling too?

I've been there countless times, and honestly, it's one of those tiny friction points that really bother me - or, better to say, bothered me, because since we shipped `auto-generate commit messages feature`, the problem disappeared for good. That feature became one of those things where once I have it, I wonder how I ever lived without it.

## The Problem with Commit Messages

**Writing good commit messages is hard.** Like, genuinely difficult. You need to:

- Summarize what changed without being too vague
- Follow your team's conventions (Conventional Commits, anyone?)
- Capture the _why_ behind the change, which is often harder than the _what_
- Keep it concise but informative
- Do all this while your brain is already moving on to the coffee machine

The result? Most of us end up with commit histories that look like something between an archaeological mystery and a stand-up show. Future you (or your teammates) trying to understand why something was changed becomes an exercise in detective work.

## How It Actually Works

Here's the thing that makes this feature genuinely useful: it only looks at your **staged changes**. Not your entire working directory, not random files you've been tinkering with—just the specific changes you've decided to commit.

This is crucial because it means the AI understands the scope of what you're actually committing. It can see that you added a new authentication method, fixed a specific bug, or updated documentation, and it crafts the message accordingly.

The process is dead simple:

1. Stage your changes (like you normally would)
2. Click the Kilo Code logo next to the commit message field
3. Get a properly formatted commit message - automagically!

<img src="https://kilo.ai/docs/img/git-commit-generation/git-commit-1.png" alt="Auto-generated commit message in VS Code" width="600" />

## Real Examples from Real Work

Let me show you some actual commit messages this feature has generated for me:

```
feat(auth): implement OAuth2 integration with GitHub

Add GitHub OAuth2 authentication flow including:
- OAuth2 client configuration
- User profile retrieval
- Token refresh mechanism
```

```
fix(api): resolve race condition in user session handling

Add proper locking mechanism to prevent concurrent
session updates from causing data corruption
```

```
docs(readme): update installation requirements

Clarify Node.js version requirements and add
troubleshooting section for common setup issues
```

Notice how these follow [Conventional Commits](https://www.conventionalcommits.org/) format by default? That's not an accident. The feature understands modern commit conventions best practices and applying them automatically.

## The Customization That Actually Matters

Here's where it gets interesting. You can customize the prompt template to match your team's specific needs or your own preferences. Don't want to be "too conventional" or just have your own standards? Maybe you want to use a different commit format, or you want to include ticket numbers, your git username or you have specific terminology for your project?

Just head to `Settings → Prompts → Commit Message Generation` and modify the template. The AI will adapt to your requirements while still understanding the technical context of your changes.

<img src="https://kilo.ai/docs/img/git-commit-generation/git-commit-2.png" alt="Customizing commit message templates" width="600" />

## Why This Isn't Just Another AI Gimmick

I've seen plenty of AI features that feel like solutions looking for problems. This isn't one of them, it actually works:

**It's contextually aware**: The AI sees your actual code changeset, not just filenames. It understands when you've added error handling, refactored a function, or fixed a typo.

**It respects your workflow**: You still stage changes the same way. You still review and edit the message if needed. It just removes the blank-page problem.

**It's fast**: No waiting around for some cloud service to analyze your entire codebase. It's quick and focused.

**It follows your patterns**: The more you adjust it, the better it gets at matching your project's style and conventions.

## The Productivity Impact

Here's the thing I didn't expect: this feature doesn't just save time on writing commit messages. It actually makes me commit more frequently and more conciously.

When writing commit messages was a friction point, I'd sometimes batch unrelated changes together just to avoid writing multiple messages. Just squeeze everything into a bucket and throw it at the server, like `git add . && git commit -m "blablabla" && git push`. Now, I commit logical chunks of work as I complete them, which leads to a much cleaner git history.

Better commit messages also mean better code reviews. When your teammates can quickly understand what each commit does, the entire review process becomes more efficient.

## Getting Started

The feature is available in Kilo Code since `v4.35` and became customizable in `v4.38`. Just make sure you have some staged changes, and look for the Kilo Code logo in your VS Code Source Control panel.

Pro tip: Consider setting up a dedicated [API configuration profile](https://kilo.ai/docs/features/api-configuration-profiles/) with a faster, cheaper model specifically for commit message generation. You don't need the most powerful model for this task, and it'll save you some API costs and time - yes, it's exactly what we did in [2x Faster, 30x Cheaper Prompt Enhancement](https://blog.kilo.ai/p/2x-faster-prompt-enhancement-in-kilo)!

## One More Thing

I mentioned I use this feature constantly, and that's not hyperbole. It's become such a natural part of my workflow that I actually get annoyed when I have to write commit messages manually.

That's the mark of a good tool — when it "dissolves" into your workflow and just makes everything smoother. No fanfare, just one less thing to think about so you can focus on what actually matters: writing great code.

Give it a try. I think you'll find yourself wondering how you ever managed without it.

---

_Want to learn more about Kilo Code's commit message generation? Check out the [full documentation](https://kilo.ai/docs/basic-usage/git-commit-generation/) I wrote for setup details. And let me know what you think about it or how could we improve it even more here in comments or on our [Discord Server](https://kilo.love/discord)!_
