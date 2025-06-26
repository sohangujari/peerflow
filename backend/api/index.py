import os
import asyncio
import json
import time
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List, Optional

PORT = int(os.getenv("PORT", 8000))

app = FastAPI()

# Enable CORS
origins = [
    "https://peerflow.vercel.app",
    "http://localhost:3000",
    "https://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store peer information
peers: Dict[str, Dict] = {}
connections: Dict[str, WebSocket] = {}

def format_peer_list() -> List[Dict]:
    return [
        {
            "id": peer_id,
            "name": peer["name"],
            "deviceType": peer["deviceType"],
            "status": "available",
            "lastSeen": peer["lastSeen"]
        }
        for peer_id, peer in peers.items()
    ]

async def broadcast_peer_list():
    if not peers:
        return
        
    peer_list = format_peer_list()
    message = json.dumps({"type": "peer-list", "peers": peer_list})
    
    for peer_id, ws in list(connections.items()):
        try:
            await ws.send_text(message)
            print(f"Sent peer list to {peer_id}")
        except Exception as e:
            print(f"Error broadcasting to {peer_id}: {e}")
            if peer_id in connections:
                del connections[peer_id]
            if peer_id in peers:
                del peers[peer_id]

async def cleanup_inactive_peers():
    while True:
        current_time = time.time()
        inactive_peers = []
        
        for peer_id, peer in list(peers.items()):
            if current_time - peer["lastSeen"] > 30:
                inactive_peers.append(peer_id)
        
        for peer_id in inactive_peers:
            try:
                if peer_id in connections:
                    await connections[peer_id].close()
                    del connections[peer_id]
                if peer_id in peers:
                    del peers[peer_id]
                print(f"Removed inactive peer: {peer_id}")
            except Exception as e:
                print(f"Error removing peer {peer_id}: {e}")
        
        if inactive_peers:
            await broadcast_peer_list()
        
        await asyncio.sleep(10)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(cleanup_inactive_peers())

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # Accept all connections (Vercel handles origin validation)
    await websocket.accept()
    
    peer_id: Optional[str] = None
    is_registered = False
    
    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                message_type = message.get("type")
                
                if message_type == "register":
                    peer_id = message.get("peerId")
                    if not peer_id:
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": "Missing peerId in registration"
                        }))
                        continue
                    
                    # Register/update peer
                    peers[peer_id] = {
                        "name": message.get("info", {}).get("name", "Unknown"),
                        "deviceType": message.get("info", {}).get("deviceType", "desktop"),
                        "lastSeen": time.time()
                    }
                    
                    connections[peer_id] = websocket
                    is_registered = True
                    
                    await websocket.send_text(json.dumps({
                        "type": "registered",
                        "peerId": peer_id,
                        "message": "Registration successful"
                    }))
                    
                    await broadcast_peer_list()
                
                elif message_type == "signal":
                    if not is_registered:
                        continue
                        
                    target_peer = message.get("targetPeer")
                    if target_peer and target_peer in connections:
                        await connections[target_peer].send_text(json.dumps({
                            "type": "signal",
                            "sourcePeer": peer_id,
                            "signal": message.get("signal")
                        }))
                
                elif message_type == "heartbeat":
                    if peer_id and peer_id in peers:
                        peers[peer_id]["lastSeen"] = time.time()
                
                elif message_type == "goodbye" and peer_id and peer_id in peers:
                    if peer_id in peers:
                        del peers[peer_id]
                    if peer_id in connections:
                        del connections[peer_id]
                    await broadcast_peer_list()
                    break
                
            except json.JSONDecodeError:
                pass
            except Exception as e:
                print(f"Error processing message: {str(e)}")
    
    except WebSocketDisconnect:
        print("WebSocket disconnected")
        if peer_id and peer_id in peers:
            del peers[peer_id]
            await broadcast_peer_list()
    except Exception as e:
        print(f"WebSocket error: {str(e)}")
    finally:
        if peer_id and peer_id in connections:
            del connections[peer_id]

@app.get("/")
async def root():
    return {
        "message": "PeerFlow Signaling Server",
        "status": "running",
        "peers": len(peers),
        "connections": len(connections)
    }

@app.get("/health")
def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")