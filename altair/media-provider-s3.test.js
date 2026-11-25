import assert from 'node:assert/strict';
import test from 'node:test';

import S3MediaProvider, { verifyRemoteMetadata } from './media-provider-s3.js';

const expected = {
  objectKey: 'media/images/team.jpg',
  size: 42,
  contentType: 'image/jpeg',
  sha256: 'abc123'
};

test('S3 verification requires matching size, type, and stored checksum metadata', () => {
  assert.doesNotThrow(() => verifyRemoteMetadata({
    ContentLength: 42,
    ContentType: 'image/jpeg',
    Metadata: { sha256: 'abc123' }
  }, expected));
  for (const remote of [
    { ContentLength: 41, ContentType: 'image/jpeg', Metadata: { sha256: 'abc123' } },
    { ContentLength: 42, ContentType: 'image/png', Metadata: { sha256: 'abc123' } },
    { ContentLength: 42, ContentType: 'image/jpeg', Metadata: { sha256: 'wrong' } }
  ]) {
    assert.throws(() => verifyRemoteMetadata(remote, expected), /Remote verification failed/);
  }
});

test('verify checks the bucket copy and, with public verification, the CDN copy', async () => {
  const configuration = {
    bucket: 'site-media', region: 'auto', credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
    forcePathStyle: false, verifyPublic: true, publicBaseUrl: 'https://cdn.example.com'
  };
  const provider = new S3MediaProvider(configuration);
  const sent = [];
  provider.client = { send: async (command) => { sent.push(command.input); return { ContentLength: 42, ContentType: 'image/jpeg', Metadata: { sha256: 'abc123' } }; } };
  const fetched = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    fetched.push(`${options.method} ${url}`);
    return new Response(null, { status: 200, headers: { 'Content-Length': '42' } });
  };
  try {
    await provider.verify(expected);
    assert.deepEqual(sent, [{ Bucket: 'site-media', Key: 'media/images/team.jpg' }]);
    assert.deepEqual(fetched, ['HEAD https://cdn.example.com/media/images/team.jpg']);

    await assert.rejects(provider.verify({ ...expected, sha256: 'other' }), /Remote verification failed/);
    globalThis.fetch = async () => new Response(null, { status: 404 });
    await assert.rejects(provider.verify(expected), /Public delivery verification failed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
