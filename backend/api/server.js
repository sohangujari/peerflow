import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { parse } from 'url';

const server = createServer();
const wss = new WebSocketServer({ noServer: true });
const peers = new Map();

// Ping clients to prevent Vercel timeout
const pingInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.ping();
    }
  });
}, 9000); // Every 9 seconds

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
            if (targetPeer.ws.readyState === targetPeer.ws.OPEN) {
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
});

server.on('upgrade', (request, socket, head) => {
  const { pathname } = parse(request.url);
  
  // Handle WebSocket connections only on /ws path
  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
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
    if (peer.ws.readyState === peer.ws.OPEN) {
      peer.ws.send(JSON.stringify({
        type: 'peer-list',
        peers: peerList
      }));
    }
  });
}

// Vercel serverless function handler
export default function handler(req, res) {
  server.emit('request', req, res);
}

server.listen(process.env.PORT || 3000);
console.log(`🚀 WebSocket server ready on port ${process.env.PORT || 3000}`);