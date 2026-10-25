import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyRemoteMetadata } from './media-provider-s3.js';

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
