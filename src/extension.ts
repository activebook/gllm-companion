import * as vscode from 'vscode';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const outputChannel = vscode.window.createOutputChannel('gllm-companion');

// Define the socket path based on the OS.
// On Windows, use named pipes. On Unix-like systems, use a file in tmp.
const SOCKET_PATH = os.platform() === 'win32' 
    ? '\\\\.\\pipe\\gllm-companion'
    : path.join(os.tmpdir(), 'gllm-companion.sock');

export function activate(context: vscode.ExtensionContext) {
    outputChannel.appendLine('Extension "gllm-companion" is now active!');

    // Clean up old socket if it exists (Unix-like systems)
    if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) {
        fs.unlinkSync(SOCKET_PATH);
    }

    const server = net.createServer((socket) => {
        let data = '';
        socket.on('data', chunk => data += chunk);
        socket.on('end', async () => {
            try {
                const msg = JSON.parse(data);
                if (msg && msg.filePath && typeof msg.newContent === 'string') {
                    await showInlineDiff(msg.filePath, msg.newContent);
                } else {
                    outputChannel.appendLine('ERROR: Invalid message format received from gllm CLI.');
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

    context.subscriptions.push({ dispose: () => {
        server.close();
        if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) {
            fs.unlinkSync(SOCKET_PATH);
        }
    }});
}

async function showInlineDiff(filePath: string, newContent: string) {
    try {
        const uri = vscode.Uri.file(filePath);
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
