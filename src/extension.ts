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
    action?: 'preview' | 'saved' | 'discard';
    filePath: string;
    newContent?: string;
}

var outputChannel: vscode.OutputChannel;

// Define the socket path based on the OS.
// On Windows, use named pipes. On Unix-like systems, use a file in tmp.
const SOCKET_PATH = os.platform() === 'win32'
    ? '\\\\.\\pipe\\gllm-companion'
    : path.join(os.tmpdir(), 'gllm-companion.sock');

export function activate(context: vscode.ExtensionContext) {
    const displayName = context.extension.packageJSON.displayName;
    outputChannel = vscode.window.createOutputChannel(displayName);
    outputChannel.appendLine('Extension "' + displayName + '" is now active!');

    // Clean up old socket if it exists (Unix-like systems)
    if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) {
        fs.unlinkSync(SOCKET_PATH);
    }

    const server = net.createServer((socket) => {
        let data = '';
        socket.on('data', chunk => data += chunk);
        socket.on('end', async () => {
            try {
                const msg = JSON.parse(data) as GllmMessage;
                if (!msg || !msg.filePath) {
                    outputChannel.appendLine('ERROR: Invalid message format received from gllm CLI. Missing filePath.');
                    return;
                }

                const action = msg.action || 'preview';

                if (action === 'preview') {
                    if (typeof msg.newContent === 'string') {
                        const uri = resolveFilePath(msg.filePath);
                        await showInlineDiff(uri, msg.newContent);
                    } else {
                        outputChannel.appendLine('ERROR: "preview" action requires newContent string.');
                    }
                } else if (action === 'saved' || action === 'discard') {
                    const uri = resolveFilePath(msg.filePath);
                    await vscode.window.showTextDocument(uri);
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

                    outputChannel.appendLine(`Action ${action} executed: Reverted buffer for ${msg.filePath} to sync with disk.`);
                } else {
                    outputChannel.appendLine(`ERROR: Unknown action type "${action}".`);
                }
            } catch (err) {
                outputChannel.appendLine(`ERROR: Error parsing JSON from gllm CLI: ${err}`);
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
    });

    context.subscriptions.push({
        dispose: () => {
            server.close();
            if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) {
                fs.unlinkSync(SOCKET_PATH);
            }
        }
    });
}

async function showInlineDiff(uri: vscode.Uri, newContent: string) {
    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);

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
        }
    } catch (err) {
        outputChannel.appendLine(`ERROR: Failed to show inline diff: ${err}`);
        vscode.window.showErrorMessage(`gllm-companion failed to open file to show diff.`);
    }
}

export function deactivate() {
    // Cleanup is handled by the subscription dispose method
}
