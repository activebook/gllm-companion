import * as vscode from 'vscode';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function resolveFilePath(filePath: string): vscode.Uri {
  if (path.isAbsolute(filePath)) {
    return vscode.Uri.file(filePath);
  }

  // If it's a relative path, resolve it against the first workspace folder
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const absolutePath = path.join(workspaceRoot, filePath);
    return vscode.Uri.file(absolutePath);
  }

  // Fallback if no workspace is open
  return vscode.Uri.file(filePath);
}

interface GllmMessage {
  action?: 'preview' | 'saved' | 'discard' | 'context';
  filePath?: string;
  newContent?: string;
}

interface GllmContext {
  activeEditor: {
    filePath: string;
    languageId: string;
    isDirty: boolean;
    content: string;
    selections: {
      start: { line: number; character: number };
      end: { line: number; character: number };
      text: string;
    }[];
    cursorPosition: { line: number; character: number };
    visibleRanges: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    }[];
  } | null;
  openFiles: {
    filePath: string;
    isDirty: boolean;
  }[];
  workspaceFolders: string[];
}

function gatherContext(): GllmContext {
  const activeTextEditor = vscode.window.activeTextEditor;
  const tabGroups = vscode.window.tabGroups.all;

  const openFiles: { filePath: string; isDirty: boolean }[] = [];
  const seenPaths = new Set<string>();

  for (const group of tabGroups) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        const fsPath = tab.input.uri.fsPath;
        if (!seenPaths.has(fsPath)) {
          seenPaths.add(fsPath);
          openFiles.push({
            filePath: fsPath,
            isDirty: tab.isDirty
          });
        }
      }
    }
  }

  let activeEditorContext: GllmContext['activeEditor'] = null;

  if (activeTextEditor) {
    const doc = activeTextEditor.document;
    activeEditorContext = {
      filePath: doc.uri.fsPath,
      languageId: doc.languageId,
      isDirty: doc.isDirty,
      content: doc.getText(),
      selections: activeTextEditor.selections.map(sel => ({
        start: { line: sel.start.line, character: sel.start.character },
        end: { line: sel.end.line, character: sel.end.character },
        text: doc.getText(sel)
      })),
      cursorPosition: {
        line: activeTextEditor.selection.active.line,
        character: activeTextEditor.selection.active.character
      },
      visibleRanges: activeTextEditor.visibleRanges.map(range => ({
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character }
      }))
    };
  }

  const workspaceFolders = (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath);

  return {
    activeEditor: activeEditorContext,
    openFiles,
    workspaceFolders
  };
}

var outputChannel: vscode.OutputChannel;
var statusBarItem: vscode.StatusBarItem;

// Define the socket path based on the OS.
// On Windows, use named pipes. On Unix-like systems, use a file in tmp.
const SOCKET_PATH = os.platform() === 'win32'
  ? '\\\\.\\pipe\\gllm-companion'
  : path.join(os.tmpdir(), 'gllm-companion.sock');

export function activate(context: vscode.ExtensionContext) {
  const displayName = context.extension.packageJSON.displayName;
  outputChannel = vscode.window.createOutputChannel(displayName);
  outputChannel.appendLine('Extension "' + displayName + '" is now active!');

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(plug) gllm: listening';
  statusBarItem.tooltip = `gllm companion server listening on ${SOCKET_PATH}`;
  statusBarItem.show();

  // Clean up old socket if it exists (Unix-like systems)
  if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }

  const server = net.createServer((socket) => {
    let data = '';
    socket.on('data', chunk => {
      data += chunk;
      // Try to parse JSON immediately to support synchronous cli request-response
      try {
        const msg = JSON.parse(data) as GllmMessage;
        handleMessage(msg, socket);
        data = ''; // Reset buffer after successful processing
      } catch (err) {
        // Not a complete JSON string yet, wait for more chunks
      }
    });

    socket.on('end', async () => {
      // If there's leftover data when the socket ends, process it
      if (data.trim() !== '') {
        try {
          const msg = JSON.parse(data) as GllmMessage;
          handleMessage(msg, socket);
        } catch (err) {
          outputChannel.appendLine(`ERROR: Error parsing JSON from gllm CLI on end: ${err}`);
        }
      }
    });

    socket.on('error', (err) => {
      outputChannel.appendLine(`ERROR: Socket error: ${err}`);
    });
  });

  server.listen(SOCKET_PATH, () => {
    outputChannel.appendLine(`Socket server started at ${SOCKET_PATH}`);
  });

  server.on('error', (err) => {
    outputChannel.appendLine(`ERROR: Server error: ${err}`);
    vscode.window.showErrorMessage(`gllm-companion failed to start socket server: ${err.message}`);
    statusBarItem.text = '$(error) gllm: error';
  });

  context.subscriptions.push({
    dispose: () => {
      server.close();
      statusBarItem.dispose();
      if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) {
        fs.unlinkSync(SOCKET_PATH);
      }
    }
  });
}

async function handleMessage(msg: GllmMessage, socket: net.Socket) {
  if (!msg) return;

  const action = msg.action || 'preview';

  if (action === 'context') {
    try {
      const ctx = gatherContext();
      socket.write(JSON.stringify(ctx) + '\\n');
      socket.end(); // Gracefully complete the transaction
      outputChannel.appendLine('Action context executed: Sent editor context to CLI.');
    } catch (err) {
      outputChannel.appendLine(`ERROR: Failed to gather context: ${err}`);
      socket.end();
    }
    return;
  }

  if (!msg.filePath) {
    outputChannel.appendLine('ERROR: Invalid message format from gllm CLI. Missing filePath for action: ' + action);
    return;
  }

  if (action === 'preview') {
    if (typeof msg.newContent === 'string') {
      const uri = resolveFilePath(msg.filePath);
      await showInlineDiff(uri, msg.newContent);
    } else {
      outputChannel.appendLine('ERROR: "preview" action requires newContent string.');
    }
  } else if (action === 'saved' || action === 'discard') {
    const activeTerminal = vscode.window.activeTerminal;
    const uri = resolveFilePath(msg.filePath);
    await vscode.window.showTextDocument(uri, { preserveFocus: true, preview: true });
    await vscode.commands.executeCommand('workbench.action.files.revert');

    // Close any open diff tabs for this file
    const tabsToClose: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputTextDiff) {
          if (tab.input.original.fsPath === uri.fsPath || tab.input.modified.fsPath === uri.fsPath) {
            tabsToClose.push(tab);
          }
        }
      }
    }
    if (tabsToClose.length > 0) {
      await vscode.window.tabGroups.close(tabsToClose);
    }

    if (activeTerminal) {
      activeTerminal.show(false);
    }

    outputChannel.appendLine(`Action ${action} executed: Reverted buffer for ${msg.filePath} to sync with disk.`);
  } else {
    outputChannel.appendLine(`ERROR: Unknown action type "${action}".`);
  }
}

async function showInlineDiff(uri: vscode.Uri, newContent: string) {
  try {
    const activeTerminal = vscode.window.activeTerminal;
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: true });

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length)
    );
    edit.replace(uri, fullRange, newContent);

    // This applies the text change in the opened editor buffer but does not save to disk.
    // VS Code's native difference tracker will show the colored gutter decorations.
    const success = await vscode.workspace.applyEdit(edit);
    if (!success) {
      vscode.window.showErrorMessage('gllm-companion failed to apply the edit.');
    } else {
      // Automatically pop open the "Compare with Saved" diff view!
      await vscode.commands.executeCommand('workbench.files.action.compareWithSaved', uri);

      // Bring focus back to the terminal if it was active
      if (activeTerminal) {
        activeTerminal.show(false);
      }
    }
  } catch (err) {
    outputChannel.appendLine(`ERROR: Failed to show inline diff: ${err}`);
    vscode.window.showErrorMessage(`gllm-companion failed to open file to show diff.`);
  }
}

export function deactivate() {
  // Cleanup is handled by the subscription dispose method
}
