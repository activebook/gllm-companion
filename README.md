# gllm Companion

Companion extension for [gllm](https://github.com/Activebook/gllm) — brings AI-suggested code changes into VSCode as native inline diffs, and enriches gllm sessions with open editor context, cursor position, and selected text.

---

## Features

### Inline Diff Review

Review and apply AI-suggested code changes directly in the editor using native inline diffs — no context switching, no copy-pasting. When gllm proposes a change, it appears as a familiar diff overlay right where your cursor is, and you decide whether to accept or discard it.

### Open Editor Context

gllm Companion automatically surfaces the files currently open in your workspace. This gives gllm a richer understanding of your project's structure and content, enabling more accurate and relevant responses without any manual setup.

### Selection Context

Whatever you highlight — a function, a block, a single line — gets passed directly to gllm as context. Combined with your current cursor position, this means gllm always knows exactly what you're looking at and can respond with surgical precision.

### Launch gllm

Start a new gllm session instantly from the Command Palette without leaving the editor.

**Command Palette** (`Cmd+Shift+P` / `Ctrl+Shift+P`) → `gllm: Run`

---

## Requirements

- [gllm](https://github.com/Activebook/gllm) must be installed and available in your `PATH`.
- Use brew on macOS to install gllm: `brew install gllm`
- Use scoop on Windows to install gllm: `scoop install gllm`
- On Linux: `curl -fsSL https://raw.githubusercontent.com/activebook/gllm/main/build/install.sh | sh`
- VSCode `1.85.0` or later.

---

## Getting Started

1. Install gllm: see the [gllm installation guide](https://github.com/Activebook/gllm#installation).
2. Install this extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Activebook.gllm-companion).
3. Open a project, select some code, and run `gllm: Run` from the Command Palette.

---

## Extension Settings

This extension does not require any configuration out of the box. gllm's own configuration (model, API keys, skills) is managed through the gllm CLI.

---

## Known Issues

Please report bugs and feature requests on the [GitHub issue tracker](https://github.com/Activebook/gllm-companion/issues).

---

## Release Notes

### 0.0.5

- Add `gllm: Run` command to initialize and show a gllm terminal session
- Add status bar item to show gllm server status
- Add context gathering for open files, cursor position, and selected text

### 0.0.4

Bugfix: Fix absolute path issue when receiving relative path from gllm.

### 0.0.3

Add windows support.

### 0.0.2

Improve inline diff review.

### 0.0.1

Initial release — inline diff review.
