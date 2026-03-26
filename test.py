import socket
import json
import os
import tempfile

def test_sock():
    sock_path = os.path.join(tempfile.gettempdir(), 'gllm-companion.sock')
    print("Socket path:", sock_path)
    
    file_path = os.path.abspath("test_file.txt")
    with open(file_path, "w") as f:
        f.write("hello\nworld\n")
    
    msg = json.dumps({"filePath": file_path, "newContent": "hello\nbrave\nnew\nworld\n"})
    
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.connect(sock_path)
            s.sendall(msg.encode('utf-8'))
            print("Sent successfully")
    except Exception as e:
        print("Failed:", e)

if __name__ == "__main__":
    test_sock()
