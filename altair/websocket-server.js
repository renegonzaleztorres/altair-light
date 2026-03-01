/**
 * WebSocket Server Module for Altair
 * Provides WebSocket server functionality for real-time bidirectional communication
 */

import { WebSocketServer as WSS } from './dependencies.js';

// Default session ID pattern:
// - Starts with alphanumeric character
// - Followed by 2-63 alphanumeric, underscore, or hyphen characters
// - Total length: 3-64 characters
const DEFAULT_SESSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/;

export class WSServer {
  constructor(httpServer, options = {}) {
    this.sessions = new Map();      // session_id → { ws, messageQueue, isAlive, lastActivity, messageTimestamps }
    this.wsToSession = new Map();   // ws → session_id (reverse lookup)
    this.path = options.path || '/ws';
    this.heartbeatInterval = options.heartbeatInterval || 30000;
    this.onMessage = options.onMessage || null;

    // Security: Session TTL (default 1 hour)
    this.sessionTTL = options.sessionTTL || 3600000;
    this.cleanupInterval = options.cleanupInterval || 60000; // Check every minute

    // Security: Queue size limit (default 100 messages)
    this.maxQueueSize = options.maxQueueSize || 100;

    // Security: Session ID validation
    this.sessionIdPattern = options.sessionIdPattern || DEFAULT_SESSION_PATTERN;

    // Security: Message size limit (default 64KB)
    this.maxMessageSize = options.maxMessageSize || 65536;

    // Security: Rate limiting (default 30 messages per 10 seconds)
    this.rateLimit = options.rateLimit || 30;
    this.rateLimitWindow = options.rateLimitWindow || 10000;

    // Security: Origin validation
    // Values: "" (reject all), "*" (allow all), "same-origin", or comma-separated list
    this.allowedOrigins = this.parseAllowedOrigins(options.allowedOrigins || '');

    // Create WebSocket server on dedicated path
    this.wss = new WSS({
      server: httpServer,
      path: this.path,
      maxPayload: this.maxMessageSize,
      verifyClient: (info) => this.verifyOrigin(info)
    });

    this.setupConnectionHandler();
    this.startHeartbeat();
    this.startCleanup();
  }

  // Parse allowed origins configuration
  parseAllowedOrigins(config) {
    if (!config || config.trim() === '') {
      return { mode: 'reject-all' };
    }

    const trimmed = config.trim();

    if (trimmed === '*') {
      console.warn('[WebSocket] WARNING: WEBSOCKET_ALLOWED_ORIGINS="*" allows all origins. Use only in development.');
      return { mode: 'allow-all' };
    }

    if (trimmed === 'same-origin') {
      return { mode: 'same-origin' };
    }

    // Comma-separated list
    const origins = trimmed.split(',').map(o => o.trim().toLowerCase()).filter(o => o);
    return { mode: 'whitelist', origins };
  }

  // Verify origin on WebSocket upgrade request
  verifyOrigin(info) {
    const origin = (info.origin || info.req.headers.origin || '').toLowerCase();
    const host = (info.req.headers.host || '').toLowerCase();

    switch (this.allowedOrigins.mode) {
      case 'reject-all':
        console.warn('[WebSocket] Connection rejected: WEBSOCKET_ALLOWED_ORIGINS not configured');
        return false;

      case 'allow-all':
        return true;

      case 'same-origin':
        // Allow http and https variants of the host
        const hostWithoutPort = host.split(':')[0];
        const allowedSameOrigin = [
          `http://${host}`,
          `https://${host}`,
          `http://${hostWithoutPort}`,
          `https://${hostWithoutPort}`
        ];
        if (allowedSameOrigin.includes(origin)) {
          return true;
        }
        console.warn(`[WebSocket] Origin rejected (same-origin mode): ${origin}`);
        return false;

      case 'whitelist':
        if (this.allowedOrigins.origins.includes(origin)) {
          return true;
        }
        console.warn(`[WebSocket] Origin rejected (not in whitelist): ${origin}`);
        return false;

      default:
        return false;
    }
  }

  setupConnectionHandler() {
    this.wss.on('connection', (ws, req) => {
      ws.isAlive = true;

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (data) => {
        // Check message size
        if (data.length > this.maxMessageSize) {
          this.send(ws, { type: 'error', error: 'Message too large' });
          return;
        }
        this.handleMessage(ws, data);
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (err) => {
        console.error('[WebSocket] Connection error:', err.message);
      });
    });

    this.wss.on('error', (err) => {
      console.error('[WebSocket] Server error:', err.message);
    });
  }

  // Validate session ID format
  validateSessionId(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') {
      return false;
    }
    return this.sessionIdPattern.test(sessionId);
  }

  // Check rate limit for a session
  checkRateLimit(session) {
    const now = Date.now();
    const windowStart = now - this.rateLimitWindow;

    // Clean old timestamps
    session.messageTimestamps = session.messageTimestamps.filter(ts => ts > windowStart);

    // Check if over limit
    if (session.messageTimestamps.length >= this.rateLimit) {
      return false;
    }

    // Record this message
    session.messageTimestamps.push(now);
    return true;
  }

  handleMessage(ws, rawData) {
    const sessionId = this.wsToSession.get(ws);

    // Rate limit check (skip for init messages from unregistered connections)
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.lastActivity = Date.now();
        if (!this.checkRateLimit(session)) {
          this.send(ws, { type: 'error', error: 'Rate limit exceeded' });
          return;
        }
      }
    }

    try {
      const message = JSON.parse(rawData.toString());

      switch (message.type) {
        case 'init':
          this.registerSession(ws, message.session_id);
          break;
        case 'ping':
          this.send(ws, { type: 'pong' });
          break;
        default:
          // Pass to custom handler if provided
          if (this.onMessage) {
            this.onMessage(sessionId, message, ws);
          }
          break;
      }
    } catch (err) {
      this.send(ws, { type: 'error', error: 'Invalid message format' });
    }
  }

  registerSession(ws, sessionId) {
    // Validate session ID format
    if (!this.validateSessionId(sessionId)) {
      this.send(ws, { type: 'error', error: 'Invalid session_id format' });
      ws.close(1008, 'Invalid session_id');
      return;
    }

    // Close old connection if session already exists
    if (this.sessions.has(sessionId)) {
      const old = this.sessions.get(sessionId);
      if (old.ws && old.ws !== ws && old.ws.readyState === 1) {
        old.ws.close(1000, 'Session replaced');
      }
    }

    const now = Date.now();
    this.sessions.set(sessionId, {
      ws,
      messageQueue: [],
      isAlive: true,
      lastActivity: now,
      messageTimestamps: []
    });
    this.wsToSession.set(ws, sessionId);

    this.send(ws, { type: 'connected', session_id: sessionId });

    // Flush any queued messages
    this.flushQueue(sessionId);
  }

  handleDisconnect(ws) {
    const sessionId = this.wsToSession.get(ws);
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (session && session.ws === ws) {
        // Keep session data but mark ws as null for potential reconnect
        session.ws = null;
        session.isAlive = false;
        session.lastActivity = Date.now();
      }
      this.wsToSession.delete(ws);
    }
  }

  // Send message to a specific WebSocket connection
  send(ws, data) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  // Send message to a session by ID
  sendToSession(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (session && session.ws && session.ws.readyState === 1) {
      session.ws.send(JSON.stringify(data));
      session.lastActivity = Date.now();
      return true;
    }
    // Queue if not connected
    this.queueMessage(sessionId, data);
    return false;
  }

  // Queue message for later delivery (with size limit)
  queueMessage(sessionId, data) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        ws: null,
        messageQueue: [],
        isAlive: false,
        lastActivity: Date.now(),
        messageTimestamps: []
      };
      this.sessions.set(sessionId, session);
    }

    // Enforce queue size limit
    if (session.messageQueue.length >= this.maxQueueSize) {
      // Remove oldest message to make room
      session.messageQueue.shift();
    }

    session.messageQueue.push(data);
    session.lastActivity = Date.now();
  }

  // Flush queued messages when connection established
  flushQueue(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session && session.ws && session.messageQueue.length > 0) {
      session.messageQueue.forEach(msg => {
        session.ws.send(JSON.stringify(msg));
      });
      session.messageQueue = [];
    }
  }

  // Get session by ID
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  // Check if session is connected
  isConnected(sessionId) {
    const session = this.sessions.get(sessionId);
    return session && session.ws && session.ws.readyState === 1;
  }

  // Get all connected session IDs
  getConnectedSessions() {
    const connected = [];
    this.sessions.forEach((session, sessionId) => {
      if (session.ws && session.ws.readyState === 1) {
        connected.push(sessionId);
      }
    });
    return connected;
  }

  // Broadcast message to all connected sessions
  broadcast(data) {
    this.wss.clients.forEach((ws) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(data));
      }
    });
  }

  // Heartbeat to detect dead connections
  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, this.heartbeatInterval);
  }

  // Stop heartbeat (for graceful shutdown)
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // Session cleanup: remove expired sessions
  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const expiredSessions = [];

      this.sessions.forEach((session, sessionId) => {
        const age = now - session.lastActivity;
        // Only clean up disconnected sessions that have expired
        if (!session.ws && age > this.sessionTTL) {
          expiredSessions.push(sessionId);
        }
      });

      expiredSessions.forEach(sessionId => {
        this.sessions.delete(sessionId);
      });

      if (expiredSessions.length > 0) {
        console.log(`[WebSocket] Cleaned up ${expiredSessions.length} expired session(s)`);
      }
    }, this.cleanupInterval);
  }

  // Stop cleanup timer
  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // Graceful shutdown
  close() {
    this.stopHeartbeat();
    this.stopCleanup();
    this.wss.clients.forEach((ws) => {
      ws.close(1001, 'Server shutting down');
    });
    this.wss.close();
  }

  // Get connection stats
  getStats() {
    let connected = 0;
    let queued = 0;
    let rateLimited = 0;
    const now = Date.now();
    const windowStart = now - this.rateLimitWindow;

    this.sessions.forEach((session) => {
      if (session.ws && session.ws.readyState === 1) {
        connected++;
      }
      queued += session.messageQueue.length;
      // Count sessions near rate limit
      const recentMessages = session.messageTimestamps.filter(ts => ts > windowStart).length;
      if (recentMessages >= this.rateLimit * 0.8) {
        rateLimited++;
      }
    });

    return {
      totalSessions: this.sessions.size,
      connectedSessions: connected,
      queuedMessages: queued,
      nearRateLimit: rateLimited
    };
  }
} // WSServer
