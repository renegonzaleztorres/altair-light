/**
 * WebSocket Server Module for Altair
 * Provides WebSocket server functionality for real-time bidirectional communication
 *
 * Loaded on demand by http-server.js only when ENABLE_WEBSOCKET=true, so ws is
 * imported here directly rather than through dependencies.js.
 */

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer as WSS } from 'ws';

// Session IDs are issued by the server (randomUUID). A client resumes a
// session only by presenting its ID together with the resume token issued
// with it, so knowing or guessing an ID is never enough to claim a session.

// Default pattern for session IDs presented on resume:
// - Starts with alphanumeric character
// - Followed by 2-63 alphanumeric, underscore, or hyphen characters
// - Total length: 3-64 characters
const DEFAULT_SESSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/;

export class WSServer {
  constructor(httpServer, options = {}) {
    this.settings = options.settings || null;
    this.sessions = new Map();      // session_id → { ws, resumeToken, messageQueue, lastActivity }
    this.wsToSession = new Map();   // ws → session_id (reverse lookup)
    this.path = options.path || this.settings?.webSocketPath || '/ws';
    this.heartbeatInterval = options.heartbeatInterval || this.settings?.webSocketHeartbeatMs || 30000;
    this.onMessage = options.onMessage || null;

    // Security: Session TTL (default 1 hour)
    this.sessionTTL = options.sessionTTL || (this.settings?.webSocketSessionTtlSecs * 1000) || 3600000;
    this.cleanupInterval = options.cleanupInterval || 60000; // Check every minute

    // Security: Queue size limit (default 100 messages)
    this.maxQueueSize = options.maxQueueSize || 100;

    // Security: Session ID validation
    this.sessionIdPattern = options.sessionIdPattern || DEFAULT_SESSION_PATTERN;

    // Security: Message size limit (default 64KB)
    this.maxMessageSize = options.maxMessageSize || 65536;

    // Security: Rate limiting per connection (default 30 messages per 10 seconds)
    this.rateLimit = options.rateLimit || 30;
    this.rateLimitWindow = options.rateLimitWindow || 10000;

    // Security: Origin validation
    // Values: "" (reject all), "*" (allow all), "same-origin", or comma-separated list
    this.allowedOrigins = this.parseAllowedOrigins(options.allowedOrigins || this.settings?.webSocketAllowedOrigins || '');

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
      ws.messageTimestamps = [];

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

  // Compare a presented resume token with the stored one in constant time
  resumeTokenMatches(expected, presented) {
    if (typeof expected !== 'string' || typeof presented !== 'string') return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(presented);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // Check rate limit for a connection (applies to every message, init included)
  checkRateLimit(ws) {
    const now = Date.now();
    const windowStart = now - this.rateLimitWindow;

    // Clean old timestamps
    ws.messageTimestamps = ws.messageTimestamps.filter(ts => ts > windowStart);

    // Check if over limit
    if (ws.messageTimestamps.length >= this.rateLimit) {
      return false;
    }

    // Record this message
    ws.messageTimestamps.push(now);
    return true;
  }

  handleMessage(ws, rawData) {
    if (!this.checkRateLimit(ws)) {
      this.send(ws, { type: 'error', error: 'Rate limit exceeded' });
      return;
    }

    const sessionId = this.wsToSession.get(ws);
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) session.lastActivity = Date.now();
    }

    let message;
    try {
      message = JSON.parse(rawData.toString());
    } catch {
      this.send(ws, { type: 'error', error: 'Invalid message format' });
      return;
    }
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      this.send(ws, { type: 'error', error: 'Invalid message format' });
      return;
    }

    switch (message.type) {
      case 'init':
        if (sessionId) {
          this.send(ws, { type: 'error', error: 'Session already initialized' });
          return;
        }
        this.registerSession(ws, message);
        break;
      case 'ping':
        this.send(ws, { type: 'pong' });
        break;
      default:
        // Only initialized connections reach the application handler
        if (!sessionId) {
          this.send(ws, { type: 'error', error: 'Session not initialized' });
          return;
        }
        if (this.onMessage) {
          try {
            this.onMessage(sessionId, message, ws);
          } catch (err) {
            console.error('[WebSocket] Message handler error:', err.message);
          }
        }
        break;
    }
  }

  // registerSession : resume a session when the client presents its ID and
  // resume token, otherwise issue a new one. The token rotates on every resume.
  registerSession(ws, message = {}) {
    const requestedId = message.session_id;
    const existing = this.validateSessionId(requestedId) ? this.sessions.get(requestedId) : null;
    const resumed = Boolean(existing && this.resumeTokenMatches(existing.resumeToken, message.resume_token));

    let sessionId;
    let session;
    if (resumed) {
      sessionId = requestedId;
      session = existing;
      if (session.ws && session.ws !== ws) {
        this.wsToSession.delete(session.ws);
        if (session.ws.readyState === 1) session.ws.close(1000, 'Session resumed elsewhere');
      }
    } else {
      sessionId = randomUUID();
      session = { ws: null, resumeToken: '', messageQueue: [], lastActivity: 0 };
      this.sessions.set(sessionId, session);
    }

    session.ws = ws;
    session.resumeToken = randomBytes(32).toString('base64url');
    session.lastActivity = Date.now();
    this.wsToSession.set(ws, sessionId);

    this.send(ws, { type: 'connected', session_id: sessionId, resume_token: session.resumeToken, resumed });

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

  // Send message to a session by ID (queues while the session is disconnected)
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

  // Queue message for later delivery (with size limit). Only sessions the
  // server issued can queue: no client could ever resume an invented ID.
  queueMessage(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Enforce queue size limit
    if (session.messageQueue.length >= this.maxQueueSize) {
      // Remove oldest message to make room
      session.messageQueue.shift();
    }

    session.messageQueue.push(data);
    session.lastActivity = Date.now();
    return true;
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
    });
    // Count connections near the rate limit
    this.wss.clients.forEach((ws) => {
      const recentMessages = (ws.messageTimestamps || []).filter(ts => ts > windowStart).length;
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
