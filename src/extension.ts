import * as vscode from 'vscode';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// --------------------------------------------------------------------------
// Actions — single source of truth for all IPC action strings.
// Using a const-object + derived union ensures plain JSON serialization
// (unlike TypeScript enums) while retaining full compile-time safety.
// --------------------------------------------------------------------------

const Actions = {
  OPEN_DIFF: 'openDiff',
  DIFF_ACCEPTED: 'diffAccepted',
  DIFF_REJECTED: 'diffRejected',
  GET_CONTEXT: 'getContext',
  SUBSCRIBE: 'subscribe',
} as const;

type Action = typeof Actions[keyof typeof Actions];

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface GllmMessage {
  action?: Action;
  filePath?: string;
  newContent?: string;
}

interface GllmContext {
  activeEditor: {
    filePath: string;
    languageId: string;
    isDirty: boolean;
    selections: {
      start: { line: number; character: number };
      end: { line: number; character: number };
      text: string;
    }[];
    cursorPosition: { line: number; character: number };
  } | null;
  otherOpenFiles: { filePath: string; isDirty: boolean }[];
  workspaceFolders: string[];
}

// --------------------------------------------------------------------------
// Active diff session state — at most one concurrent diff is supported.
// --------------------------------------------------------------------------

interface DiffSession {
  uri: vscode.Uri;
  // No socket stored — openDiff is fire-and-forget; events flow via the subscriber pipe.
}

let activeSession: DiffSession | null = null;
let subscribers: net.Socket[] = [];

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const SOCKET_PATH =
  os.platform() === 'win32'
    ? '\\\\.\\pipe\\gllm-companion'
    : path.join(os.tmpdir(), 'gllm-companion.sock');

const CTX_ACTIVE_DIFF = 'gllm-companion.activeDiff';

// --------------------------------------------------------------------------
// Globals
// --------------------------------------------------------------------------

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;

// --------------------------------------------------------------------------
// Activation
// --------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
  const displayName = context.extension.packageJSON.displayName;
  outputChannel = vscode.window.createOutputChannel(displayName);
  outputChannel.appendLine(`Extension "${displayName}" is now active!`);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(plug) gllm: listening';
  statusBarItem.tooltip = `gllm companion server listening on ${SOCKET_PATH}`;
  statusBarItem.show();

  // Clean up stale socket file on Unix-like systems.
  if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }

  // ---- Socket server ----
  const server = net.createServer((socket) => {
    let buf = '';

    socket.on('data', (chunk) => {
      buf += chunk;
      try {
        const msg = JSON.parse(buf) as GllmMessage;
        buf = '';
        handleMessage(msg, socket);
      } catch {
        // Incomplete JSON — wait for more chunks.
      }
    });

    socket.on('end', () => {
      if (buf.trim()) {
        try {
          const msg = JSON.parse(buf) as GllmMessage;
          handleMessage(msg, socket);
        } catch (err) {
          outputChannel.appendLine(`ERROR: Failed to parse JSON on socket end: ${err}`);
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

  // ---- Commands ----
  context.subscriptions.push(
    vscode.commands.registerCommand('gllm-companion.run', startGllmSession),
    vscode.commands.registerCommand('gllm-companion.diff.accept', handleAccept),
    vscode.commands.registerCommand('gllm-companion.diff.cancel', handleCancel),
  );

  // ---- Defensive cleanup: detect manual tab closure ----
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      if (!activeSession) { return; }

      const closedDiff = event.closed.some((tab) => {
        if (!(tab.input instanceof vscode.TabInputTextDiff)) { return false; }
        return (
          tab.input.original.fsPath === activeSession!.uri.fsPath ||
          tab.input.modified.fsPath === activeSession!.uri.fsPath
        );
      });

      if (closedDiff) {
        outputChannel.appendLine('Diff tab closed manually — treating as discard.');
        broadcastToSubscribers({ action: Actions.DIFF_REJECTED, filePath: activeSession.uri.fsPath });        
      }
    })
  );

  // ---- Disposal ----
  context.subscriptions.push({
    dispose: () => {
      disposeSession();
      server.close();
      statusBarItem.dispose();
      if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) {
        fs.unlinkSync(SOCKET_PATH);
      }
    },
  });
}

// --------------------------------------------------------------------------
// Command handlers
// --------------------------------------------------------------------------

async function handleAccept() {
  if (!activeSession) {
    outputChannel.appendLine('WARN: diff.accept fired with no active session.');
    return;
  }

  const { uri } = activeSession;

  // Save the buffer to disk.
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
  if (doc && doc.isDirty) {
    const saved = await doc.save();
    if (!saved) {
      vscode.window.showErrorMessage('gllm-companion: Failed to save the file.');
      return;
    }
  }

  broadcastToSubscribers({ action: Actions.DIFF_ACCEPTED, filePath: uri.fsPath });
  await closeDiffTabs(uri);
  outputChannel.appendLine(`Diff accepted and saved: ${uri.fsPath}`);
}

async function handleCancel() {
  if (!activeSession) {
    outputChannel.appendLine('WARN: diff.cancel fired with no active session.');
    return;
  }

  const { uri } = activeSession;

  // Revert the buffer to match the on-disk state (undo the applyEdit).
  await vscode.window.showTextDocument(uri, { preserveFocus: true, preview: true });
  await vscode.commands.executeCommand('workbench.action.files.revert');

  broadcastToSubscribers({ action: Actions.DIFF_REJECTED, filePath: uri.fsPath });
  await closeDiffTabs(uri);
  outputChannel.appendLine(`Diff cancelled — reverted: ${uri.fsPath}`);
}

// --------------------------------------------------------------------------
// Socket message handler
// --------------------------------------------------------------------------

async function handleMessage(msg: GllmMessage, socket: net.Socket) {
  if (!msg || !msg.action) {
    outputChannel.appendLine('ERROR: Missing action field in message.');
    socket.end();
    return;
  }

  const action = msg.action;

  // ---- Context request (synchronous query, no diff session needed) ----
  if (action === Actions.GET_CONTEXT) {
    try {
      socket.write(JSON.stringify(gatherContext()));
      socket.end();
      outputChannel.appendLine('Context sent to CLI.');
    } catch (err) {
      outputChannel.appendLine(`ERROR: Failed to gather context: ${err}`);
      socket.end();
    }
    return;
  }

  // ---- Subscribe request (persistent connection for receiving events) ----
  if (action === Actions.SUBSCRIBE) {
    if (!subscribers.includes(socket)) {
      subscribers.push(socket);
    }
    socket.on('close', () => {
      subscribers = subscribers.filter((s) => s !== socket);
    });
    socket.on('error', () => {
      subscribers = subscribers.filter((s) => s !== socket);
    });
    outputChannel.appendLine('CLI connected to subscriber pipe.');
    return;
  }

  // ---- Validate file path for diff actions ----
  if (!msg.filePath) {
    outputChannel.appendLine(`ERROR: Missing filePath for action "${action}".`);
    socket.end();
    return;
  }

  if (action === Actions.OPEN_DIFF) {
    if (typeof msg.newContent !== 'string') {
      outputChannel.appendLine('ERROR: "preview" action requires a newContent string.');
      socket.end();
      return;
    }

    // If a prior session is still alive, clean it up first.
    if (activeSession) {
      const oldPath = activeSession.uri.fsPath;
      broadcastToSubscribers({ action: Actions.DIFF_REJECTED, filePath: oldPath });
    }

    const uri = resolveFilePath(msg.filePath);
    // Store the session — uri is used by Accept/Cancel handlers and tab-close guard.
    activeSession = { uri };

    await showInlineDiff(uri, msg.newContent);
    // Trigger Accept/Cancel buttons and hotkey overrides.
    await vscode.commands.executeCommand('setContext', CTX_ACTIVE_DIFF, true);

    outputChannel.appendLine(`Diff preview opened: ${msg.filePath}`);
    return;
  }

  // ---- CLI-driven saved/discard ----
  if (action === Actions.DIFF_ACCEPTED || action === Actions.DIFF_REJECTED) {
    const uri = resolveFilePath(msg.filePath);
    // Clear session state FIRST to avoid triggering onDidChangeTabs
    disposeSession();
    await vscode.window.showTextDocument(uri, { preserveFocus: true, preview: true });
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await closeDiffTabs(uri);
    socket.end();
    outputChannel.appendLine(`CLI action "${action}" executed for ${msg.filePath}`);
    return;
  }

  outputChannel.appendLine(`ERROR: Unknown action type "${action}".`);
  socket.end();
}

// --------------------------------------------------------------------------
// Session helpers
// --------------------------------------------------------------------------

function broadcastToSubscribers(payload: object) {
  // Clear session state FIRST to avoid race conditions with CLI response
  // If the session was active, it means we're transitioning to a new session or clearing state after an accept/reject.
  disposeSession();
  
  if (!payload) { return; }
  // No subscribers? Nothing to do.
  if (subscribers.length === 0) { return; }
  const data = JSON.stringify(payload);
  subscribers.forEach((s) => {
    try {
      s.write(data);
    } catch (err) {
      outputChannel.appendLine(`ERROR: Failed to write to subscriber socket: ${err}`);
    }
  });
}

function disposeSession() {
  // Clear VSCode context so buttons/hotkeys disappear.
  vscode.commands.executeCommand('setContext', CTX_ACTIVE_DIFF, false);
  activeSession = null;
}

// --------------------------------------------------------------------------
// UI helpers
// --------------------------------------------------------------------------

async function showInlineDiff(uri: vscode.Uri, newContent: string) {
  try {
    const activeTerminal = vscode.window.activeTerminal;
    const doc = await vscode.workspace.openTextDocument(uri);

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    edit.replace(uri, fullRange, newContent);

    const success = await vscode.workspace.applyEdit(edit);
    if (!success) {
      vscode.window.showErrorMessage('gllm-companion: Failed to apply the suggested edit.');
      return;
    }

    await vscode.commands.executeCommand('workbench.files.action.compareWithSaved', uri);

    if (activeTerminal) {
      activeTerminal.show(false);
    }
  } catch (err) {
    outputChannel.appendLine(`ERROR: Failed to show inline diff: ${err}`);
    vscode.window.showErrorMessage(`gllm-companion: Failed to open file for diff preview.`);
  }
}

async function closeDiffTabs(uri: vscode.Uri) {
  const tabs: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputTextDiff) {
        if (
          tab.input.original.fsPath === uri.fsPath ||
          tab.input.modified.fsPath === uri.fsPath
        ) {
          tabs.push(tab);
        }
      }
    }
  }
  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs);
  }
}

// --------------------------------------------------------------------------
// Utility
// --------------------------------------------------------------------------

function resolveFilePath(filePath: string): vscode.Uri {
  if (path.isAbsolute(filePath)) {
    return vscode.Uri.file(filePath);
  }
  if (vscode.workspace.workspaceFolders?.length) {
    return vscode.Uri.file(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath));
  }
  return vscode.Uri.file(filePath);
}

function gatherContext(): GllmContext {
  const activeTextEditor = vscode.window.activeTextEditor;
  const openFiles: { filePath: string; isDirty: boolean }[] = [];
  const seen = new Set<string>();

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        const fsPath = tab.input.uri.fsPath;
        if (!seen.has(fsPath)) {
          seen.add(fsPath);
          openFiles.push({ filePath: fsPath, isDirty: tab.isDirty });
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
      selections: activeTextEditor.selections
        .filter((sel) => !sel.isEmpty)
        .map((sel) => ({
          start: { line: sel.start.line, character: sel.start.character },
          end: { line: sel.end.line, character: sel.end.character },
          text: doc.getText(sel),
        })),
      cursorPosition: {
        line: activeTextEditor.selection.active.line,
        character: activeTextEditor.selection.active.character,
      },
    };
  }

  return {
    activeEditor: activeEditorContext,
    otherOpenFiles: openFiles,
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
  };
}

function startGllmSession() {
  let terminal = vscode.window.terminals.find((t) => t.name === 'gllm');
  const isNew = !terminal;
  terminal ??= vscode.window.createTerminal('gllm');
  terminal.show();
  if (isNew) { terminal.sendText('gllm'); }
}

export function deactivate() {
  // Cleanup is handled by the subscription dispose callback.
}
