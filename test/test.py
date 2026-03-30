import socket
import json
import os
import tempfile
import argparse

def test_sock(action="discard", content=None):
    sock_path = os.path.join(tempfile.gettempdir(), 'gllm-companion.sock')
    print("Socket path:", sock_path)
    
    file_path = os.path.abspath("test/test.js")
    with open(file_path, "w") as f:
        f.write("const outputChannel = vscode.window.createOutputChannel('gllm-companion');\\noutputChannel.appendLine('Socket server started at ' + SOCKET_PATH);\\n")
    
    # Build message based on action type
    if action == "preview":
        new_content = content if content else "console.log('Congratulations, your extension \"gllm-companion\" is now active!');"
        msg = json.dumps({"action": "preview", "filePath": file_path, "newContent": new_content})
    elif action == "saved":
        msg = json.dumps({"action": "saved", "filePath": file_path})
    elif action == "discard":
        msg = json.dumps({"action": "discard", "filePath": file_path})
    elif action == "context":
        msg = json.dumps({"action": "context"})
    else:
        print(f"Unknown action: {action}")
        print("Valid actions: preview, saved, discard, context")
        return
    
    print(f"Action: {action}")
    print(f"Message: {msg}")
    
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.connect(sock_path)
            s.sendall(msg.encode('utf-8'))
            print("Sent successfully")
            
            if action == "context":
                print("Waiting for response...")
                s.shutdown(socket.SHUT_WR)
                
                response = b""
                while True:
                    data = s.recv(4096)
                    if not data:
                        break
                    response += data
                
                print("\\n--- Response Received ---")
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
  preview    Send preview action with optional content
  saved      Send saved action
  discard    Send discard action
  context    Request active editor contextual awareness

Examples:
  %(prog)s preview                    # Preview with default content
  %(prog)s preview -c "console.log('test')"  # Preview with custom content
  %(prog)s saved                      # Send saved action
  %(prog)s discard                    # Send discard action
  %(prog)s context                    # Request context payload"""
    )
    parser.add_argument(
        "action",
        nargs="?",
        choices=["preview", "saved", "discard", "context"],
        help="Action type to test"
    )
    parser.add_argument(
        "-c", "--content",
        default=None,
        help="Content for preview action (optional)"
    )
    
    args = parser.parse_args()
    
    # Show help if no action provided
    if not args.action:
        parser.print_help()
        exit(0)
    
    test_sock(args.action, args.content)
