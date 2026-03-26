import socket
import json
import os
import tempfile

def test_sock():
    sock_path = os.path.join(tempfile.gettempdir(), 'gllm-companion.sock')
    print("Socket path:", sock_path)
    
    file_path = os.path.abspath("test/test.js")
    with open(file_path, "w") as f:
        f.write("const outputChannel = vscode.window.createOutputChannel('gllm-companion');\noutputChannel.appendLine('Socket server started at ' + SOCKET_PATH);\n")
    
    msg = json.dumps({"filePath": file_path, "newContent": "console.log('Congratulations, your extension \"gllm-companion\" is now active!');"})
    
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.connect(sock_path)
            s.sendall(msg.encode('utf-8'))
            print("Sent successfully")
    except Exception as e:
        print("Failed:", e)

if __name__ == "__main__":
    test_sock()
