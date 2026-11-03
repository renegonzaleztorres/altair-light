import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import WebSocket from 'ws';
import { WSServer } from './websocket-server.js';

// startServer : HTTP server with a WSServer on a free port
const startServer = async (options = {}) => {
  const httpServer = createServer();
  const received = [];
  const wsServer = new WSServer(httpServer, {
    allowedOrigins: 'http://altair.test',
    onMessage: (sessionId, message) => received.push({ sessionId, message }),
    ...options,
  });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const url = `ws://127.0.0.1:${httpServer.address().port}/ws`;
  const close = async () => {
    wsServer.close();
    httpServer.close();
    await once(httpServer, 'close');
  };
  return { wsServer, url, received, close };
};

// connect : open a client that buffers incoming messages
const connect = async (url) => {
  const socket = new WebSocket(url, { headers: { Origin: 'http://altair.test' } });
  const inbox = [];
  const waiters = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const waiter = waiters.shift();
    if (waiter) waiter(message); else inbox.push(message);
  });
  await once(socket, 'open');
  const next = () => inbox.length > 0 ? Promise.resolve(inbox.shift()) : new Promise((resolve) => waiters.push(resolve));
  const send = (message) => socket.send(JSON.stringify(message));
  const request = (message) => { send(message); return next(); };
  const close = async () => {
    if (socket.readyState === WebSocket.CLOSED) return;
    socket.close();
    await once(socket, 'close');
  };
  return { socket, next, send, request, close };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test('the server issues the session ID and a resume token', async () => {
  const { url, close } = await startServer();
  const client = await connect(url);
  try {
    const reply = await client.request({ type: 'init' });
    assert.equal(reply.type, 'connected');
    assert.match(reply.session_id, /^[0-9a-f-]{36}$/);
    assert.equal(typeof reply.resume_token, 'string');
    assert.ok(reply.resume_token.length >= 40);
    assert.equal(reply.resumed, false);
  } finally {
    await client.close();
    await close();
  }
});

test('a client cannot claim another session by ID alone', async () => {
  const { wsServer, url, close } = await startServer();
  const victim = await connect(url);
  const attacker = await connect(url);
  try {
    const { session_id: victimId } = await victim.request({ type: 'init' });
    await victim.close();
    await settle();
    wsServer.sendToSession(victimId, { secret: 42 });

    const reply = await attacker.request({ type: 'init', session_id: victimId });
    assert.equal(reply.resumed, false);
    assert.notEqual(reply.session_id, victimId);

    const guessed = await attacker.request({ type: 'ping' });
    assert.deepEqual(guessed, { type: 'pong' });
    assert.equal(wsServer.getSession(victimId).messageQueue.length, 1);
  } finally {
    await attacker.close();
    await close();
  }
});

test('the resume token restores the session, delivers the queue and rotates', async () => {
  const { wsServer, url, close } = await startServer();
  const first = await connect(url);
  const second = await connect(url);
  const third = await connect(url);
  try {
    const issued = await first.request({ type: 'init' });
    await first.close();
    await settle();
    wsServer.sendToSession(issued.session_id, { queued: 1 });

    const resumed = await second.request({ type: 'init', session_id: issued.session_id, resume_token: issued.resume_token });
    assert.equal(resumed.session_id, issued.session_id);
    assert.equal(resumed.resumed, true);
    assert.notEqual(resumed.resume_token, issued.resume_token);
    assert.deepEqual(await second.next(), { queued: 1 });

    const replayed = await third.request({ type: 'init', session_id: issued.session_id, resume_token: issued.resume_token });
    assert.equal(replayed.resumed, false);
    assert.notEqual(replayed.session_id, issued.session_id);
  } finally {
    await second.close();
    await third.close();
    await close();
  }
});

test('resuming from a second connection closes the first one', async () => {
  const { url, close } = await startServer();
  const first = await connect(url);
  const second = await connect(url);
  try {
    const issued = await first.request({ type: 'init' });
    const closed = once(first.socket, 'close');
    await second.request({ type: 'init', session_id: issued.session_id, resume_token: issued.resume_token });
    const [code] = await closed;
    assert.equal(code, 1000);
  } finally {
    await second.close();
    await close();
  }
});

test('one init per connection, so repeated init cannot leak sessions', async () => {
  const { wsServer, url, close } = await startServer();
  const client = await connect(url);
  try {
    await client.request({ type: 'init' });
    const again = await client.request({ type: 'init' });
    assert.deepEqual(again, { type: 'error', error: 'Session already initialized' });
    await client.close();
    await settle();
    assert.equal(wsServer.sessions.size, 1);
    assert.equal([...wsServer.sessions.values()][0].ws, null);
  } finally {
    await close();
  }
});

test('messages before init are rejected and never reach the application', async () => {
  const { url, received, close } = await startServer();
  const client = await connect(url);
  try {
    const reply = await client.request({ type: 'chat', text: 'hi' });
    assert.deepEqual(reply, { type: 'error', error: 'Session not initialized' });
    assert.deepEqual(await client.request({ type: 'ping' }), { type: 'pong' });

    const { session_id: sessionId } = await client.request({ type: 'init' });
    client.send({ type: 'chat', text: 'hello' });
    await settle();
    assert.deepEqual(received, [{ sessionId, message: { type: 'chat', text: 'hello' } }]);
  } finally {
    await client.close();
    await close();
  }
});

test('the rate limit applies per connection, before and after init', async () => {
  const { url, close } = await startServer({ rateLimit: 3 });
  const client = await connect(url);
  try {
    for (let i = 0; i < 3; i += 1) assert.deepEqual(await client.request({ type: 'ping' }), { type: 'pong' });
    assert.deepEqual(await client.request({ type: 'init' }), { type: 'error', error: 'Rate limit exceeded' });
  } finally {
    await client.close();
    await close();
  }
});

test('sending to an unknown session neither queues nor creates a session', async () => {
  const { wsServer, close } = await startServer();
  try {
    assert.equal(wsServer.sendToSession('user-abc123', { hello: true }), false);
    assert.equal(wsServer.sessions.size, 0);
  } finally {
    await close();
  }
});

test('invalid JSON and non-object messages get a format error', async () => {
  const { url, close } = await startServer();
  const client = await connect(url);
  try {
    client.socket.send('not json');
    assert.deepEqual(await client.next(), { type: 'error', error: 'Invalid message format' });
    client.socket.send('null');
    assert.deepEqual(await client.next(), { type: 'error', error: 'Invalid message format' });
  } finally {
    await client.close();
    await close();
  }
});
