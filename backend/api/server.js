import { WebSocketServer } from 'ws';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = process.env.PORT || 8080;
const SSL_ENABLED = process.env.NODE_ENV === 'production';
const HEARTBEAT_INTERVAL = 10000; // 10 seconds

const peers = new Map();
let wss;

if (SSL_ENABLED) {
  // Production - use SSL for secure WebSocket (wss)
  const sslOptions = {
    key: fs.readFileSync(path.join(__dirname, 'ssl', 'private.key')),
    cert: fs.readFileSync(path.join(__dirname, 'ssl', 'certificate.crt'))
  };
  
  const server = https.createServer(sslOptions);
  wss = new WebSocketServer({ 
    server,
    path: '/ws'
  });
  
  server.listen(PORT, () => {
    console.log(`Secure WebSocket server running on wss://0.0.0.0:${PORT}/ws`);
  });
} else {
  // Development
  wss = new WebSocketServer({ 
    port: PORT,
    path: '/ws'
  });
  console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
}

// Heartbeat system to detect dead connections
const heartbeatInterval = setInterval(() => {
  const now = Date.now();
  peers.forEach((peer, id) => {
    if (now - peer.lastSeen > 30000) { // 30 seconds timeout
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
}, HEARTBEAT_INTERVAL);

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`New connection from: ${ip}`);
  
  let peerId = null;
  
  // Initial peer info
  const peerInfo = {
    ws,
    lastSeen: Date.now(),
    ip,
    name: '',
    deviceType: ''
  };

  ws.on('message', (rawData) => {
    try {
      const data = JSON.parse(rawData);
      peerInfo.lastSeen = Date.now();
      
      switch (data.type) {
        case 'register':
          peerId = data.peerId;
          peers.set(peerId, {
            ...peerInfo,
            name: data.info.name || `Unknown-${peerId.slice(-4)}`,
            deviceType: data.info.deviceType || 'desktop'
          });
          console.log(`Registered peer: ${peerId} (${data.info.name})`);
          broadcastPeerList();
          break;
          
        case 'signal':
          if (data.targetPeer && peers.has(data.targetPeer)) {
            const targetPeer = peers.get(data.targetPeer);
            if (targetPeer.ws.readyState === 1) { // OPEN state
              targetPeer.ws.send(JSON.stringify({
                type: 'signal',
                sourcePeer: peerId,
                signal: data.signal
              }));
            }
          }
          break;
          
        case 'heartbeat':
          // Already handled by lastSeen update
          break;
          
        case 'goodbye':
          if (peerId) {
            peers.delete(peerId);
            broadcastPeerList();
            console.log(`Peer disconnected: ${peerId}`);
          }
          break;
          
        default:
          console.warn(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for ${peerId || 'unknown peer'}:`, error.message);
  });

  ws.on('close', () => {
    if (peerId) {
      peers.delete(peerId);
      broadcastPeerList();
      console.log(`Connection closed: ${peerId}`);
    }
  });

  // Send initial peer list
  ws.send(JSON.stringify({
    type: 'peer-list',
    peers: formatPeerList()
  }));
});

// Format peer list for clients
function formatPeerList() {
  return Array.from(peers.entries()).map(([id, info]) => ({
    id,
    name: info.name,
    deviceType: info.deviceType,
    status: 'available',
    lastSeen: info.lastSeen
  }));
}

// Broadcast updated peer list to all connected clients
function broadcastPeerList() {
  const peerList = formatPeerList();
  
  peers.forEach((peer) => {
    if (peer.ws.readyState === 1) { // OPEN state
      try {
        peer.ws.send(JSON.stringify({
          type: 'peer-list',
          peers: peerList
        }));
      } catch (e) {
        console.error('Error broadcasting to peer:', peer.id, e);
      }
    }
  });
}

// Cleanup on server shutdown
process.on('SIGINT', () => {
  clearInterval(heartbeatInterval);
  wss.close(() => {
    console.log('Server shutdown complete');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});