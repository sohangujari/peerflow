import React, { useState, useEffect, useRef } from 'react';
import { Send, File, Users, Wifi, Download, Copy, Check, RefreshCw, Smartphone, Tablet, Monitor } from 'lucide-react';

export default function P2PApp() {
  const [peerId, setPeerId] = useState('');
  const [peerName, setPeerName] = useState('');
  const [peers, setPeers] = useState(new Map());
  const [activePeer, setActivePeer] = useState(null);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState(new Map());
  const [files, setFiles] = useState(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deviceType, setDeviceType] = useState('desktop');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  
  const connections = useRef(new Map());
  const dataChannels = useRef(new Map());
  const fileInputRef = useRef(null);
  const pendingFiles = useRef(new Map());
  const wsRef = useRef(null);
  const heartbeatInterval = useRef(null);
  const reconnectTimeout = useRef(null);
  const peerIdRef = useRef('');
  const peerNameRef = useRef('');
  const deviceTypeRef = useRef('');

  // Generate memorable peer name
  const generatePeerName = () => {
    const colors = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Cyan', 'Magenta'];
    const animals = ['Lion', 'Tiger', 'Bear', 'Eagle', 'Wolf', 'Dolphin', 'Fox', 'Hawk'];
    const nature = ['Mountain', 'River', 'Forest', 'Ocean', 'Desert', 'Sky', 'Valley', 'Canyon'];
    
    const randomCategory = Math.random() > 0.5 ? animals : nature;
    const randomItem = randomCategory[Math.floor(Math.random() * randomCategory.length)];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    return `${randomColor}${randomItem}`;
  };

  // Detect device type
  const detectDeviceType = () => {
    const userAgent = navigator.userAgent.toLowerCase();
    if (/mobile|android|iphone|phone|ipod|blackberry|iemobile/i.test(userAgent)) {
      return 'mobile';
    } else if (/tablet|ipad|playbook|silk/i.test(userAgent)) {
      return 'tablet';
    } else {
      return 'laptop';
    }
  };

  // Connect to WebSocket server
  const connectWebSocket = () => {
    // Determine WebSocket URL based on current host
    let wsUrl;
    
    if (window.location.hostname === 'peerflow.vercel.app') {
      // Production URL (replace with your actual backend URL)
      wsUrl = 'wss://peerflow-backend.yourdomain.com/ws';
    } else {
      // Local development
      wsUrl = 'ws://localhost:8000/ws';
    }
    
    console.log(`Connecting to WebSocket: ${wsUrl}`);
    wsRef.current = new WebSocket(wsUrl);
    setConnectionStatus('connecting');
    
    wsRef.current.onopen = () => {
      console.log('WebSocket connected');
      setConnectionStatus('connected');
      
      // Register with signaling server
      const name = generatePeerName();
      wsRef.current.send(JSON.stringify({
        type: 'register',
        peerId: peerIdRef.current,
        info: {
          name: name,
          deviceType: deviceTypeRef.current
        }
      }));
      
      setPeerName(name);
      startHeartbeat();
    };
    
    wsRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('Received message:', data);
        
        switch (data.type) {
          case 'peer-list':
            handlePeerList(data.peers);
            break;
          case 'signal':
            handleSignal(data.sourcePeer, data.signal);
            break;
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    };
    
    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnectionStatus('error');
    };
    
    wsRef.current.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      setConnectionStatus('disconnected');
      
      // Clear existing heartbeat
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
        heartbeatInterval.current = null;
      }
      
      // Attempt reconnect after 3 seconds
      if (!reconnectTimeout.current) {
        reconnectTimeout.current = setTimeout(() => {
          console.log('Attempting to reconnect WebSocket...');
          reconnectTimeout.current = null;
          connectWebSocket();
        }, 3000);
      }
    };
  };

  const startHeartbeat = () => {
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current);
    }
    
    heartbeatInterval.current = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && peerIdRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'heartbeat',
          peerId: peerIdRef.current
        }));
      }
    }, 10000); // Send heartbeat every 10 seconds
  };

  // Initialize peer
  useEffect(() => {
    const id = `peer_${Math.random().toString(36).substr(2, 8)}`;
    const device = detectDeviceType();
    
    // Set refs for consistent access
    peerIdRef.current = id;
    deviceTypeRef.current = device;
    
    // Update state
    setPeerId(id);
    setDeviceType(device);
    
    // Connect to WebSocket server
    connectWebSocket();
    
    // Cleanup
    return () => {
      cleanup();
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
      }
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
    };
  }, []);

  const handlePeerList = (peerList) => {
    const newPeers = new Map();
    peerList.forEach(peer => {
      // Don't add ourselves to the peer list
      if (peer.id !== peerIdRef.current) {
        newPeers.set(peer.id, {
          id: peer.id,
          name: peer.name,
          deviceType: peer.deviceType || detectDeviceType(),
          lastSeen: Date.now(),
          status: 'available'
        });
      }
    });
    setPeers(newPeers);
  };

  const handleSignal = async (sourcePeer, signal) => {
    try {
      console.log('Received signal:', signal.type, 'from', sourcePeer);
      
      switch (signal.type) {
        case 'offer':
          await handleWebRTCOffer(sourcePeer, signal);
          break;
        case 'answer':
          await handleWebRTCAnswer(sourcePeer, signal);
          break;
        case 'candidate':
          await handleWebRTCIce(sourcePeer, signal.candidate);
          break;
      }
    } catch (error) {
      console.error('Error handling signal:', error);
    }
  };

  const cleanup = () => {
    // Send goodbye message if possible
    if (wsRef.current && peerIdRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({
          type: 'goodbye',
          peerId: peerIdRef.current
        }));
      } catch (e) {
        console.error('Error sending goodbye:', e);
      }
      wsRef.current.close();
    }
    
    // Close all WebRTC connections
    connections.current.forEach(conn => {
      try {
        conn.close();
      } catch (e) {
        console.error('Error closing connection:', e);
      }
    });
    connections.current.clear();
    dataChannels.current.clear();
  };

  // Get device icon
  const getDeviceIcon = (deviceType) => {
    switch (deviceType) {
      case 'mobile':
        return <Smartphone size={16} className="text-blue-500" />;
      case 'tablet':
        return <Tablet size={16} className="text-purple-500" />;
      case 'laptop':
        return <Monitor size={16} className="text-green-500" />;
      default:
        return <Monitor size={16} className="text-gray-500" />;
    }
  };

  // Create WebRTC connection
  const createConnection = async (remotePeerId, isInitiator = false) => {
    if (connections.current.has(remotePeerId)) {
      return connections.current.get(remotePeerId);
    }
    
    // Use free public STUN servers
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' }
      ]
    };
    
    const connection = new RTCPeerConnection(configuration);
    connections.current.set(remotePeerId, connection);
    
    connection.onicecandidate = (event) => {
      if (event.candidate && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log('Sending ICE candidate to', remotePeerId);
        wsRef.current.send(JSON.stringify({
          type: 'signal',
          targetPeer: remotePeerId,
          signal: {
            type: 'candidate',
            candidate: event.candidate
          }
        }));
      }
    };
    
    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      console.log(`Connection state with ${remotePeerId}: ${state}`);
      
      if (state === 'connected') {
        setPeers(prev => {
          const newPeers = new Map(prev);
          const peer = newPeers.get(remotePeerId);
          if (peer) {
            peer.status = 'connected';
            newPeers.set(remotePeerId, peer);
          }
          return newPeers;
        });
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        setPeers(prev => {
          const newPeers = new Map(prev);
          const peer = newPeers.get(remotePeerId);
          if (peer) {
            peer.status = 'available';
            newPeers.set(remotePeerId, peer);
          }
          return newPeers;
        });
        dataChannels.current.delete(remotePeerId);
        connections.current.delete(remotePeerId);
        
        // If active peer disconnected, clear active
        if (activePeer === remotePeerId) {
          setActivePeer(null);
        }
      }
    };
    
    connection.oniceconnectionstatechange = () => {
      console.log(`ICE connection state: ${connection.iceConnectionState}`);
    };
    
    if (isInitiator) {
      console.log('Creating data channel for', remotePeerId);
      const dataChannel = connection.createDataChannel('communication', { ordered: true });
      setupDataChannel(dataChannel, remotePeerId);
    } else {
      connection.ondatachannel = (event) => {
        console.log('Received data channel from', remotePeerId);
        setupDataChannel(event.channel, remotePeerId);
      };
    }
    return connection;
  };

  // Setup data channel
  const setupDataChannel = (channel, remotePeerId) => {
    dataChannels.current.set(remotePeerId, channel);

    channel.onopen = () => {
      console.log(`Data channel opened with ${remotePeerId}`);
      setPeers(prev => {
        const newPeers = new Map(prev);
        const peer = newPeers.get(remotePeerId);
        if (peer) {
          peer.status = 'connected';
          newPeers.set(remotePeerId, peer);
        }
        return newPeers;
      });
    };

    channel.onclose = () => {
      console.log(`Data channel closed with ${remotePeerId}`);
      dataChannels.current.delete(remotePeerId);
      setPeers(prev => {
        const newPeers = new Map(prev);
        const peer = newPeers.get(remotePeerId);
        if (peer) {
          peer.status = 'available';
          newPeers.set(remotePeerId, peer);
        }
        return newPeers;
      });
    };

    channel.onmessage = (event) => {
      handleDataChannelMessage(event.data, remotePeerId);
    };
  };

  // Handle data channel messages
  const handleDataChannelMessage = (data, remotePeerId) => {
    try {
      if (typeof data === 'string') {
        const parsedData = JSON.parse(data);
        if (parsedData.type === 'message') {
          setMessages(prev => {
            const newMessages = new Map(prev);
            const peerMessages = newMessages.get(remotePeerId) || [];
            newMessages.set(remotePeerId, [...peerMessages, {
              id: Date.now(),
              text: parsedData.text,
              sender: 'remote',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }]);
            return newMessages;
          });
        } else if (parsedData.type === 'file-info') {
          console.log('Received file info:', parsedData);
          pendingFiles.current.set(parsedData.fileId, {
            name: parsedData.name,
            size: parsedData.size,
            type: parsedData.fileType,
            chunks: [],
            receivedChunks: 0,
            totalChunks: parsedData.totalChunks,
            remotePeerId
          });
        }
      } else if (data instanceof ArrayBuffer) {
        const view = new DataView(data);
        const fileIdLen = view.getUint8(0);
        let offset = 1;
        const fileIdBytes = new Uint8Array(data, offset, fileIdLen);
        const fileId = new TextDecoder().decode(fileIdBytes);
        offset += fileIdLen;
        const chunkIndex = view.getUint32(offset, true);
        offset += 4;
        const chunk = data.slice(offset);
        const fileInfo = pendingFiles.current.get(fileId);
        
        if (fileInfo) {
          console.log(`Received chunk ${chunkIndex} of ${fileInfo.totalChunks} for ${fileId}`);
          fileInfo.chunks[chunkIndex] = chunk;
          fileInfo.receivedChunks++;
          
          if (fileInfo.receivedChunks === fileInfo.totalChunks) {
            console.log('All chunks received for', fileId);
            const blob = new Blob(fileInfo.chunks, { type: fileInfo.type });
            setFiles(prev => {
              const newFiles = new Map(prev);
              const peerFiles = newFiles.get(remotePeerId) || [];
              newFiles.set(remotePeerId, [...peerFiles, {
                id: fileId,
                name: fileInfo.name,
                size: fileInfo.size,
                blob,
                sender: 'remote',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              }]);
              return newFiles;
            });
            pendingFiles.current.delete(fileId);
          }
        }
      }
    } catch (error) {
      console.error('Error handling data channel message:', error);
    }
  };

  // Handle WebRTC offer
  const handleWebRTCOffer = async (remotePeerId, offer) => {
    try {
      console.log('Handling offer from', remotePeerId);
      const connection = await createConnection(remotePeerId, false);
      await connection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'signal',
          targetPeer: remotePeerId,
          signal: {
            type: 'answer',
            sdp: answer.sdp
          }
        }));
      }
    } catch (error) {
      console.error('Error handling WebRTC offer:', error);
    }
  };

  // Handle WebRTC answer
  const handleWebRTCAnswer = async (remotePeerId, answer) => {
    try {
      console.log('Handling answer from', remotePeerId);
      const connection = connections.current.get(remotePeerId);
      if (connection) {
        await connection.setRemoteDescription(new RTCSessionDescription({
          type: 'answer',
          sdp: answer.sdp
        }));
      }
    } catch (error) {
      console.error('Error handling WebRTC answer:', error);
    }
  };

  // Handle WebRTC ICE candidate
  const handleWebRTCIce = async (remotePeerId, candidate) => {
    try {
      console.log('Handling ICE candidate from', remotePeerId);
      const connection = connections.current.get(remotePeerId);
      if (connection && candidate) {
        await connection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  };

  // Connect to peer
  const connectToPeer = async (remotePeerId) => {
    if (connections.current.has(remotePeerId)) {
      setActivePeer(remotePeerId);
      return;
    }

    try {
      console.log('Connecting to peer:', remotePeerId);
      const connection = await createConnection(remotePeerId, true);
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'signal',
          targetPeer: remotePeerId,
          signal: {
            type: 'offer',
            sdp: offer.sdp
          }
        }));
      }
      
      setActivePeer(remotePeerId);
    } catch (error) {
      console.error('Error connecting to peer:', error);
      alert('Failed to connect to peer. Please try again.');
    }
  };

  // Send message
  const sendMessage = () => {
    if (!message.trim() || !activePeer) return;
    
    const dataChannel = dataChannels.current.get(activePeer);
    if (!dataChannel || dataChannel.readyState !== 'open') {
      alert('Not connected to peer. Please wait for connection to establish.');
      return;
    }
    
    const messageObj = { type: 'message', text: message };
    
    try {
      dataChannel.send(JSON.stringify(messageObj));
      
      setMessages(prev => {
        const newMessages = new Map(prev);
        const peerMessages = newMessages.get(activePeer) || [];
        newMessages.set(activePeer, [...peerMessages, {
          id: Date.now(),
          text: message,
          sender: 'local',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
        return newMessages;
      });
      
      setMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Connection may be unstable.');
    }
  };

  // Send file
  const sendFile = async (file) => {
    if (!file || !activePeer) return;
    const dataChannel = dataChannels.current.get(activePeer);
    if (!dataChannel || dataChannel.readyState !== 'open') {
      alert('Not connected to peer. Please wait for connection to establish.');
      return;
    }
    
    const fileId = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const chunkSize = 16 * 1024; // 16KB chunks
    const arrayBuffer = await file.arrayBuffer();
    const totalChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);
    
    try {
      // Send file info
      dataChannel.send(JSON.stringify({
        type: 'file-info',
        fileId,
        name: file.name,
        size: file.size,
        fileType: file.type,
        totalChunks
      }));
      
      console.log(`Sending file: ${file.name} (${totalChunks} chunks)`);
      
      // Send file chunks
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, arrayBuffer.byteLength);
        const chunk = arrayBuffer.slice(start, end);
        
        const fileIdBytes = new TextEncoder().encode(fileId);
        const header = new Uint8Array(1 + fileIdBytes.length + 4);
        header[0] = fileIdBytes.length;
        header.set(fileIdBytes, 1);
        new DataView(header.buffer).setUint32(1 + fileIdBytes.length, i, true);
        
        const payload = new Uint8Array(header.length + chunk.byteLength);
        payload.set(header, 0);
        payload.set(new Uint8Array(chunk), header.length);
        
        dataChannel.send(payload.buffer);
        await new Promise(resolve => setTimeout(resolve, 5)); // Throttle sends
      }
      
      console.log('File sent successfully');
      
      // Add to local file list
      setFiles(prev => {
        const newFiles = new Map(prev);
        const peerFiles = newFiles.get(activePeer) || [];
        newFiles.set(activePeer, [...peerFiles, {
          id: fileId,
          name: file.name,
          size: file.size,
          blob: file,
          sender: 'local',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
        return newFiles;
      });
    } catch (error) {
      console.error('Error sending file:', error);
      alert('Failed to send file. Connection may be unstable.');
    }
  };

  // Handle file selection
  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) sendFile(file);
    event.target.value = '';
  };

  // Download file
  const downloadFile = (file) => {
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Copy peer ID
  const copyPeerId = () => {
    navigator.clipboard.writeText(peerId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Refresh peers
  const refreshPeers = () => {
    setIsScanning(true);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'heartbeat',
        peerId: peerIdRef.current
      }));
    }
    setTimeout(() => setIsScanning(false), 2000);
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Connection status indicator
  const connectionStatusIndicator = () => {
    switch (connectionStatus) {
      case 'connected':
        return <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-green-500 mr-2"></span>Connected</span>;
      case 'connecting':
        return <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-yellow-500 mr-2"></span>Connecting...</span>;
      case 'error':
        return <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-red-500 mr-2"></span>Connection Error</span>;
      default:
        return <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-gray-500 mr-2"></span>Disconnected</span>;
    }
  };

  // Get current messages and files
  const currentMessages = activePeer ? messages.get(activePeer) || [] : [];
  const currentFiles = activePeer ? files.get(activePeer) || [] : [];
  const activePeerInfo = activePeer ? peers.get(activePeer) : null;
  const isConnectedToActivePeer = activePeerInfo?.status === 'connected' && 
                                 dataChannels.current.get(activePeer)?.readyState === 'open';

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
                <Wifi className="text-blue-500" />
                PeerFlow
              </h1>
              <p className="text-gray-600 text-sm mt-1">
                Direct peer-to-peer file and message sharing
              </p>
            </div>
            
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <div className="text-sm text-gray-600">Your ID:</div>
                <div className="flex items-center gap-2">
                  <code className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">
                    {peerId}
                  </code>
                  <button
                    onClick={copyPeerId}
                    className="p-1 text-gray-500 hover:text-gray-700"
                    title="Copy ID"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
              </div>
              <div className="text-sm text-gray-600 flex items-center">
                {connectionStatusIndicator()}
              </div>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Peers Panel */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
                <Users className="text-green-500" size={20} />
                Available Peers
              </h2>
              <button
                onClick={refreshPeers}
                disabled={isScanning}
                className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-50"
                title="Refresh peers"
              >
                <RefreshCw size={16} className={isScanning ? 'animate-spin' : ''} />
              </button>
            </div>
            
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {Array.from(peers.values()).length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 mb-2">No peers found yet</p>
                  <p className="text-xs text-gray-400">
                    Make sure signaling server is running and other devices are connected
                  </p>
                </div>
              ) : (
                Array.from(peers.values()).map((peer) => (
                  <div
                    key={peer.id}
                    onClick={() => connectToPeer(peer.id)}
                    className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                      activePeer === peer.id
                        ? 'bg-blue-50 border-blue-300'
                        : 'hover:bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getDeviceIcon(peer.deviceType)}
                        <div>
                          <div className="font-medium text-sm">{peer.name}</div>
                          <div className="text-xs text-gray-500 font-mono">
                            {peer.id.slice(-8)}
                          </div>
                        </div>
                      </div>
                      <div className={`w-2 h-2 rounded-full ${
                        peer.status === 'connected' ? 'bg-green-500' : 'bg-gray-400'
                      }`} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Messages Panel */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Send className="text-blue-500" size={20} />
              Messages
              {activePeerInfo && (
                <span className="text-sm font-normal text-gray-500">
                  - {activePeerInfo.name}
                </span>
              )}
            </h2>
            
            <div className="h-64 overflow-y-auto mb-4 border rounded-md p-3 bg-gray-50 flex flex-col gap-2">
              {!activePeer ? (
                <p className="text-gray-500 text-center py-8">
                  Select a peer to start messaging
                </p>
              ) : currentMessages.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  No messages yet. Start the conversation!
                </p>
              ) : (
                currentMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-3 rounded-lg max-w-xs ${
                      msg.sender === 'local'
                        ? 'bg-blue-500 text-white self-end'
                        : 'bg-white text-gray-800 border self-start'
                    }`}
                  >
                    <p className="text-sm">{msg.text}</p>
                    <p className={`text-xs mt-1 ${
                      msg.sender === 'local' ? 'text-blue-100' : 'text-gray-500'
                    }`}>
                      {msg.timestamp}
                    </p>
                  </div>
                ))
              )}
            </div>
            
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder={activePeer ? "Type a message..." : "Select a peer first"}
                  disabled={!activePeer}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-100"
                />
                <button
                  onClick={sendMessage}
                  disabled={!message.trim() || !activePeer}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-400 transition-colors"
                >
                  <Send size={16} />
                </button>
              </div>
              {activePeer && !isConnectedToActivePeer && (
                <p className="text-xs text-yellow-600">
                  Connecting to peer... Please wait.
                </p>
              )}
            </div>
          </div>

          {/* Files Panel */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <File className="text-purple-500" size={20} />
              Files
              {activePeerInfo && (
                <span className="text-sm font-normal text-gray-500">
                  - {activePeerInfo.name}
                </span>
              )}
            </h2>
            
            <div className="h-64 overflow-y-auto mb-4 border rounded-md p-3 bg-gray-50">
              {!activePeer ? (
                <p className="text-gray-500 text-center py-8">
                  Select a peer to share files
                </p>
              ) : currentFiles.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  No files shared yet
                </p>
              ) : (
                currentFiles.map((file) => (
                  <div
                    key={file.id}
                    className={`mb-3 p-3 rounded-md border ${
                      file.sender === 'local'
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-green-50 border-green-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {file.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatFileSize(file.size)} • {file.timestamp}
                        </p>
                      </div>
                      {file.sender === 'remote' && (
                        <button
                          onClick={() => downloadFile(file)}
                          className="ml-2 p-1 text-green-600 hover:text-green-800 transition-colors"
                          title="Download file"
                        >
                          <Download size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!activePeer}
                className="w-full px-4 py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600 disabled:bg-gray-400 transition-colors flex items-center justify-center gap-2"
              >
                <File size={16} />
                Share File
              </button>
              {activePeer && !isConnectedToActivePeer && (
                <p className="text-xs text-yellow-600 text-center">
                  Connecting to peer... Please wait.
                </p>
              )}
              {!activePeer && (
                <p className="text-xs text-gray-500 text-center">
                  Select a peer to share files
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="mt-6 bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-3">How PeerFlow Works</h3>
          <div className="grid md:grid-cols-3 gap-4 text-sm text-gray-600">
            <div>
              <h4 className="font-medium text-gray-800 mb-2">Connection:</h4>
              <ul className="space-y-1">
                <li>• Signaling server coordinates connections</li>
                <li>• WebRTC establishes direct peer-to-peer links</li>
                <li>• No data passes through the server</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-gray-800 mb-2">Messaging:</h4>
              <ul className="space-y-1">
                <li>• Messages are encrypted end-to-end</li>
                <li>• Sent directly between devices</li>
                <li>• Works even without internet (on same network)</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-gray-800 mb-2">File Sharing:</h4>
              <ul className="space-y-1">
                <li>• Files transfer directly between devices</li>
                <li>• Large files supported with chunking</li>
                <li>• No size limits (browser memory constraints)</li>
              </ul>
            </div>
          </div>
          
          <div className="mt-4 text-xs text-gray-500 border-t pt-3">
            <p>Status: {connectionStatus} | Device: {deviceType} | Your Name: {peerName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}