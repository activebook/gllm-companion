import socket
import json
import os
import tempfile
import argparse

DEFAULT_JS_CONTENT = "const outputChannel = vscode.window.createOutputChannel('gllm-companion');\noutputChannel.appendLine('Socket server started at ' + SOCKET_PATH);\n"

def prepare_test_file(file_path, content=DEFAULT_JS_CONTENT):
    if os.path.exists(file_path) and os.path.getsize(file_path) > 0:
        return
    with open(file_path, "w") as f:
        f.write(content)

def test_sock(action="diffRejected", content=None):
    sock_path = os.path.join(tempfile.gettempdir(), 'gllm-companion.sock')
    print("Socket path:", sock_path)
    
    # Build message based on action type
    if action == "openDiff":
        file_path = os.path.abspath("test/test.js")
        prepare_test_file(file_path)
        
        new_content = content if content else "console.log('Congratulations, your extension \"gllm-companion\" is now active!');"
        msg = json.dumps({"action": "openDiff", "filePath": file_path, "newContent": new_content})
    elif action == "diffAccepted":
        file_path = os.path.abspath("test/test.js")
        msg = json.dumps({"action": "diffAccepted", "filePath": file_path})
    elif action == "diffRejected":
        file_path = os.path.abspath("test/test.js")
        msg = json.dumps({"action": "diffRejected", "filePath": file_path})
    elif action == "getContext":
        msg = json.dumps({"action": "getContext"})
    else:
        print(f"Unknown action: {action}")
        print("Valid actions: openDiff, diffAccepted, diffRejected, getContext")
        return
    
    print(f"Action: {action}")
    print(f"Message: {msg}")
    
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.connect(sock_path)
            s.sendall(msg.encode('utf-8'))
            print("Sent successfully")
            
            if action == "getContext":
                print("Waiting for response...")
                s.shutdown(socket.SHUT_WR)
                
                response = b""
                while True:
                    data = s.recv(4096)
                    if not data:
                        break
                    response += data
                
                print("\n--- Response Received ---")
                try:
                    parsed = json.loads(response.decode('utf-8'))
                    print(json.dumps(parsed, indent=2))
                except json.JSONDecodeError:
                    print("Raw Output:")
                    print(response.decode('utf-8'))
    except Exception as e:
        print("Failed:", e)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Test gllm-companion socket with different actions",
        usage="""%(prog)s <action> [options]

Actions:
  openDiff   Send openDiff action with optional content
  diffAccepted  Send diffAccepted action
  diffRejected  Send diffRejected action
  getContext    Request active editor contextual awareness

Examples:
  %(prog)s openDiff                   # Preview with default content
  %(prog)s openDiff -c "console.log('test')"  # Preview with custom content
  %(prog)s diffAccepted               # Send diffAccepted action
  %(prog)s diffRejected               # Send diffRejected action
  %(prog)s getContext                 # Request context payload"""
    )
    parser.add_argument(
        "action",
        nargs="?",
        choices=["openDiff", "diffAccepted", "diffRejected", "getContext"],
        help="Action type to test"
    )
    parser.add_argument(
        "-c", "--content",
        default=None,
        help="Content for openDiff action (optional)"
    )
    
    args = parser.parse_args()
    
    # Show help if no action provided
    if not args.action:
        parser.print_help()
        exit(0)
    
    test_sock(args.action, args.content)
