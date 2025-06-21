import WebSocket from 'ws';
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });
const peers = new Map();

wss.on('connection', (ws) => {
  let peerId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      switch (data.type) {
        case 'register':
          peerId = data.peerId;
          peers.set(peerId, { ws, ...data.info });
          broadcastPeerList();
          break;

        case 'signal':
          if (peers.has(data.targetPeer)) {
            const targetPeer = peers.get(data.targetPeer);
            if (targetPeer.ws.readyState === WebSocket.OPEN) {
              targetPeer.ws.send(JSON.stringify({
                type: 'signal',
                sourcePeer: peerId,
                signal: data.signal
              }));
            }
          }
          break;

        case 'heartbeat':
          if (peerId && peers.has(peerId)) {
            peers.set(peerId, { ...peers.get(peerId), lastSeen: Date.now() });
          }
          break;

        case 'goodbye':
          if (peerId) {
            peers.delete(peerId);
            broadcastPeerList();
          }
          break;
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    if (peerId) {
      peers.delete(peerId);
      broadcastPeerList();
    }
  });

  function broadcastPeerList() {
    const peerList = Array.from(peers.entries()).map(([id, info]) => ({
      id,
      name: info.name,
      deviceType: info.deviceType,
      status: 'available'
    }));

    peers.forEach((peer) => {
      if (peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(JSON.stringify({
          type: 'peer-list',
          peers: peerList
        }));
      }
    });
  }
});

console.log('WebSocket signaling server running on ws://localhost:8080');