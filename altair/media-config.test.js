import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  createMediaRedirectUrl,
  mediaRequestTarget,
  resolveMediaConfiguration
} from './media-config.js';

test('media and manifest paths derive from the configured active space', () => {
  const configuration = resolveMediaConfiguration({
    appRootPath: '/srv/site',
    activeSpace: 'spaces/blue',
    publicLocation: 'web',
    mediaLocation: 'assets/media',
    mediaCdnFallback: false
  });
  assert.equal(configuration.mediaPath, path.resolve('/srv/site/spaces/blue/web/assets/media'));
  assert.equal(configuration.manifestPath, path.resolve('/srv/site/spaces/blue/.altair/media-publication.json'));
  assert.equal(configuration.mediaRelativePath, 'web/assets/media');
  assert.equal(configuration.mediaUrlPrefix, '/assets/media');
});

test('media locations reject empty, absolute, traversal, and private paths', () => {
  for (const mediaLocation of ['', '/', '/media', '../media', 'images/../media', '_media', 'media\\images']) {
    assert.throws(() => resolveMediaConfiguration({
      appRootPath: '/srv/site',
      activeSpace: 'spaces/blue',
      publicLocation: 'public',
      mediaLocation
    }), undefined, mediaLocation);
  }
});

test('CDN bases require a safe origin and HTTPS outside local testing', () => {
  const settings = {
    appRootPath: '/srv/site',
    activeSpace: 'spaces/blue',
    publicLocation: 'public',
    mediaLocation: 'media',
    mediaCdnFallback: true
  };
  assert.throws(() => resolveMediaConfiguration({ ...settings, mediaCdnBaseUrl: 'http://media.example.com' }));
  assert.throws(() => resolveMediaConfiguration({ ...settings, mediaCdnBaseUrl: 'https://media.example.com/path' }));
  assert.equal(
    resolveMediaConfiguration({ ...settings, mediaCdnBaseUrl: 'https://media.example.com' }).cdnBaseUrl,
    'https://media.example.com'
  );
  assert.equal(
    resolveMediaConfiguration({ ...settings, mediaCdnBaseUrl: 'http://127.0.0.1:9000' }).cdnBaseUrl,
    'http://127.0.0.1:9000'
  );
});

test('media request targets preserve queries and reject unsafe or unrelated paths', () => {
  const target = mediaRequestTarget('https://site.test/media/team%20photo.jpg?v=2', '/media');
  assert.deepEqual(target, { pathname: '/media/team%20photo.jpg', search: '?v=2' });
  assert.equal(createMediaRedirectUrl('https://media.example.com', target), 'https://media.example.com/media/team%20photo.jpg?v=2');
  assert.equal(mediaRequestTarget('not a URL', '/media'), null);
  assert.equal(mediaRequestTarget('https://site.test/media', '/media'), null);
  assert.equal(mediaRequestTarget('https://site.test/media/', '/media'), null);
  assert.equal(mediaRequestTarget('https://site.test/images/team.jpg', '/media'), null);
  assert.equal(mediaRequestTarget('https://site.test/media/_private.jpg', '/media'), null);
  assert.equal(mediaRequestTarget('https://site.test/media/%252e%252e/secret.jpg', '/media'), null);
});
