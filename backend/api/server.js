import { WebSocketServer } from 'ws';
import http from 'http';
import express from 'express';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Middleware for Vercel health checks
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Create WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });
const peers = new Map();

// Enhanced heartbeat system
const heartbeatInterval = setInterval(() => {
  const now = Date.now();
  peers.forEach((peer, id) => {
    if (now - peer.lastSeen > 45000) {
      console.log(`Removing inactive peer: ${id}`);
      try {
        peer.ws.close(1001, 'Connection timeout');
      } catch (e) {
        console.error('Error closing connection:', e);
      }
      peers.delete(id);
      broadcastPeerList();
    }
  });
}, 15000);

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`New connection from: ${ip}`);
  
  let peerId = null;
  const connectionInfo = {
    ws,
    lastSeen: Date.now(),
    ip,
    name: '',
    deviceType: ''
  };

  // Send initial peer list immediately
  ws.send(JSON.stringify({
    type: 'peer-list',
    peers: formatPeerList()
  }));

  ws.on('message', (rawData) => {
    try {
      const data = JSON.parse(rawData);
      connectionInfo.lastSeen = Date.now();
      
      switch (data.type) {
        case 'register':
          peerId = data.peerId;
          peers.set(peerId, {
            ...connectionInfo,
            name: data.info.name || `Unknown-${peerId.slice(-4)}`,
            deviceType: data.info.deviceType || 'desktop'
          });
          console.log(`Registered peer: ${peerId} (${data.info.name})`);
          broadcastPeerList();
          break;
          
        case 'signal':
          if (data.targetPeer && peers.has(data.targetPeer)) {
            const targetPeer = peers.get(data.targetPeer);
            if (targetPeer.ws.readyState === 1) {
              targetPeer.ws.send(JSON.stringify({
                type: 'signal',
                sourcePeer: peerId,
                signal: data.signal
              }));
            }
          }
          break;
          
        default:
          console.log(`Received ${data.type} from ${peerId || 'unknown peer'}`);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    if (peerId) {
      peers.delete(peerId);
      broadcastPeerList();
      console.log(`Connection closed: ${peerId}`);
    }
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error: ${error.message}`);
  });
});

function formatPeerList() {
  return Array.from(peers.entries()).map(([id, info]) => ({
    id,
    name: info.name,
    deviceType: info.deviceType,
    status: 'available'
  }));
}

function broadcastPeerList() {
  const peerList = formatPeerList();
  console.log(`Broadcasting to ${peers.size} peers`);
  
  peers.forEach((peer) => {
    if (peer.ws.readyState === 1) {
      try {
        peer.ws.send(JSON.stringify({
          type: 'peer-list',
          peers: peerList
        }));
      } catch (e) {
        console.error(`Error broadcasting to ${peer.id}:`, e);
      }
    }
  });
}

// Start server when running locally
if (process.env.NODE_ENV !== 'production') {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  process.on('SIGINT', () => {
    clearInterval(heartbeatInterval);
    wss.close();
    server.close();
    console.log('Server shutdown complete');
    process.exit(0);
  });
}

// Export for Vercel serverless
export default (req, res) => {
  if (req.url === '/health') {
    res.status(200).send('OK');
    return;
  }
  
  if (req.headers.upgrade === 'websocket') {
    wss.handleUpgrade(req, req.socket, Buffer.alloc(0), (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    res.status(426).send('Upgrade Required');
  }
};