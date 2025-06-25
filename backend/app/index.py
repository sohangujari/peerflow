import os
import asyncio
import json
import time
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List

app = FastAPI()

# Enable CORS for all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://peerflow.vercel.app"],
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
            "status": "available"
        }
        for peer_id, peer in peers.items()
    ]

async def broadcast_peer_list():
    """Broadcast updated peer list to all connected clients"""
    peer_list = format_peer_list()
    message = json.dumps({"type": "peer-list", "peers": peer_list})
    
    for peer_id, ws in connections.items():
        try:
            if ws.client_state.CONNECTED:
                await ws.send_text(message)
        except Exception as e:
            print(f"Error broadcasting to {peer_id}: {e}")

async def cleanup_inactive_peers():
    """Periodically remove inactive peers"""
    while True:
        current_time = time.time()
        inactive_peers = []
        
        for peer_id, peer in peers.items():
            if current_time - peer["lastSeen"] > 30:  # 30 seconds timeout
                inactive_peers.append(peer_id)
        
        for peer_id in inactive_peers:
            try:
                if peer_id in connections:
                    await connections[peer_id].close()
                    del connections[peer_id]
                if peer_id in peers:
                    del peers[peer_id]
            except Exception as e:
                print(f"Error removing peer {peer_id}: {e}")
        
        if inactive_peers:
            await broadcast_peer_list()
        
        await asyncio.sleep(10)  # Check every 10 seconds

@app.on_event("startup")
async def startup_event():
    """Start background tasks on server startup"""
    asyncio.create_task(cleanup_inactive_peers())

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for signaling"""
    await websocket.accept()
    peer_id = None
    
    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                message_type = message.get("type")
                
                # Handle registration
                if message_type == "register":
                    peer_id = message["peerId"]
                    peers[peer_id] = {
                        "name": message["info"]["name"],
                        "deviceType": message["info"]["deviceType"],
                        "lastSeen": time.time()
                    }
                    connections[peer_id] = websocket
                    await broadcast_peer_list()
                
                # Handle signaling
                elif message_type == "signal":
                    target_peer = message["targetPeer"]
                    if target_peer in connections:
                        await connections[target_peer].send_text(json.dumps({
                            "type": "signal",
                            "sourcePeer": peer_id,
                            "signal": message["signal"]
                        }))
                
                # Handle heartbeat
                elif message_type == "heartbeat" and peer_id in peers:
                    peers[peer_id]["lastSeen"] = time.time()
                
                # Handle disconnection
                elif message_type == "goodbye" and peer_id in peers:
                    del peers[peer_id]
                    await broadcast_peer_list()
                    break
            
            except json.JSONDecodeError:
                print("Invalid JSON received")
            except KeyError as e:
                print(f"Missing key in message: {e}")
    
    except WebSocketDisconnect:
        if peer_id and peer_id in peers:
            del peers[peer_id]
            await broadcast_peer_list()
    finally:
        if peer_id and peer_id in connections:
            del connections[peer_id]

@app.get("/")
async def root():
    return {
        "message": "PeerFlow Signaling Server",
        "endpoints": {
            "websocket": "/ws",
            "health": "/health"
        }
    }

@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "ok", "peers": len(peers)}

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")