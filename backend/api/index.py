import os
import asyncio
import json
import time
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List, Optional

# Get port from environment variable or default to 8000
PORT = int(os.getenv("PORT", 8000))

app = FastAPI()

# Enable CORS for production and development
origins = [
    "https://peerflow.vercel.app",
    "http://localhost:3000",
    "http://localhost:8000",
    "https://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store peer information
peers: Dict[str, Dict] = {}
connections: Dict[str, WebSocket] = {}

def format_peer_list() -> List[Dict]:
    """Format the peer list for broadcasting"""
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
    """Broadcast updated peer list to all connected clients"""
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
    """Periodically remove inactive peers"""
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
        else:
            # Broadcast peer list periodically even if no changes
            await broadcast_peer_list()
        
        await asyncio.sleep(10)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(cleanup_inactive_peers())

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    origin = websocket.headers.get("origin", "")
    allowed_origins = [
        "https://peerflow.vercel.app",
        "http://localhost:3000",
        "http://localhost:8000",
        "https://localhost:3000",
    ]
    
    ENV = os.getenv("ENV", "development")
    if ENV == "production" and origin not in allowed_origins:
        print(f"Rejected connection from unauthorized origin: {origin}")
        await websocket.close(code=1008)
        return
    
    await websocket.accept()
    print(f"WebSocket connection accepted from {origin}")
    
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
                    
                    # Always update peer information
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
                    print(f"Registered peer: {peer_id}")
                    
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
            print(f"Cleaned up connection for peer: {peer_id}")

@app.get("/")
async def root():
    return {
        "message": "PeerFlow Signaling Server",
        "status": "running",
        "endpoints": {
            "websocket": "/ws",
            "health_check": "/health"
        },
        "stats": {
            "active_peers": len(peers),
            "active_connections": len(connections)
        }
    }

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "peers": len(peers),
        "connections": len(connections)
    }

if __name__ == "__main__":
    uvicorn.run("api.index:app", host="0.0.0.0", port=PORT, log_level="info")