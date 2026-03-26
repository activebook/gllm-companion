# gllm-companion

A VS Code extension that bridges the [gllm](https://github.com/Activebook/gllm) CLI tool with the editor, enabling native inline diffs for AI-suggested code changes.

## How It Works

When `gllm` generates a code change, it sends the new file content over a local socket to this extension. The extension applies the change to the editor buffer (without saving to disk), letting VS Code's built-in diff tracker render colored gutter decorations — so you can review, accept, or discard the suggestion naturally.

```
gllm CLI  ──(IPC socket)──▶  gllm-companion  ──▶  VS Code inline diff
```

## Requirements

- VS Code `^1.85.0`
- [gllm](https://github.com/Activebook/gllm) CLI installed

## Installation

Install from the VS Code Marketplace or build from source:

```bash
npm install
npm run compile
```

To package as a `.vsix`:

```bash
npx vsce package
```

Then install via **Extensions: Install from VSIX…** in the command palette.

## IPC Protocol

The extension listens on:

| Platform | Socket path |
|----------|-------------|
| Unix/macOS | `$TMPDIR/gllm-companion.sock` |
| Windows | `\\.\pipe\gllm-companion` |

The `gllm` CLI sends a single JSON message per connection:

```json
{
  "filePath": "/absolute/path/to/file.ts",
  "newContent": "... full updated file content ..."
}
```

## License

MIT
