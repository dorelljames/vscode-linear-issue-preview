# Linear Inline Issues

See Linear issue details inline in VS Code. Reference an issue key like `DEV-4513` anywhere — code comments, commit messages, markdown — and get its details without opening Linear.

<img width="1444" height="902" alt="CleanShot 2026-07-04 at 13 29 07@2x" src="https://github.com/user-attachments/assets/855800bb-a645-4189-a12c-49e1f3860972" />
<img width="924" height="774" alt="CleanShot 2026-07-04 at 13 30 11@2x" src="https://github.com/user-attachments/assets/aa66751a-c3f4-41fb-af0c-fe6124741a7c" />


## Features

- **Hover card** — hover any issue key to see status, title, assignee, priority, labels and a description preview, with quick actions (Open in Linear, Details, Copy branch name).
- **Inline status** — a subtle `● In Progress` badge rendered after each issue key, colored with the workflow state's actual color from your Linear workspace. Toggle with `linearIssues.inlineStatus`.
- **Cmd+Click** — issue keys become links that open the issue in Linear.
- **Details panel** — full description and recent comments in a side panel (`Linear Issues: Open Issue Details`, or via the hover card).
- **Smart matching** — team key prefixes are auto-detected from your workspace, so things like `UTF-8` are never misdetected. Override with `linearIssues.teamKeys`.

## Setup

1. In Linear: **Settings → Security & access → Personal API keys** → create a key.
2. In VS Code: run **`Linear Issues: Set API Key`** from the command palette and paste it. The key is stored in VS Code's secret storage (Keychain on macOS).

## Development

```sh
npm install
npm run compile   # or: npm run watch
```

Press <kbd>F5</kbd> to launch an Extension Development Host.

Package a `.vsix` with `npm run package`, then install via **Extensions: Install from VSIX…**.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `linearIssues.inlineStatus` | `true` | Show inline status badge after issue keys |
| `linearIssues.teamKeys` | `[]` | Team prefixes to recognize; empty = auto-detect |
| `linearIssues.cacheTtlSeconds` | `300` | Issue data cache lifetime |
| `linearIssues.hoverDescriptionLength` | `600` | Max description characters in the hover |
