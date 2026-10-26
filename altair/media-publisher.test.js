import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveMediaConfiguration } from './media-config.js';
import {
  MEDIA_CACHE_CONTROL,
  acquirePublicationLock,
  createPublisherConfiguration,
  publishMedia,
  redactSensitiveValues,
  readManifest
} from './media-publisher.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z6aAAAAAASUVORK5CYII=',
  'base64'
);

const createFixture = async () => {
  const appRootPath = await mkdtemp(path.join(os.tmpdir(), 'altair-media-publisher-'));
  const base = resolveMediaConfiguration({
    appRootPath,
    activeSpace: 'spaces/custom',
    publicLocation: 'public',
    mediaLocation: 'media',
    mediaCdnFallback: false
  });
  await mkdir(base.mediaPath, { recursive: true });
  return {
    appRootPath,
    configuration: {
      ...base,
      provider: 's3-compatible',
      bucket: 'test-media',
      endpoint: '',
      region: 'test',
      cacheControl: MEDIA_CACHE_CONTROL
    }
  };
};

class FakeProvider {
  constructor({ fail = false } = {}) {
    this.fail = fail;
    this.uploads = [];
  }

  async uploadAndVerify(file) {
    if (this.fail) throw new Error('simulated remote mismatch');
    this.uploads.push({
      objectKey: file.objectKey,
      size: file.size,
      contentType: file.contentType,
      sha256: file.sha256,
      cacheControl: file.cacheControl
    });
  }
}

test('publisher uploads new and edited media, skips unchanged bytes, and retains remote-only entries', async () => {
  const fixture = await createFixture();
  const imagePath = path.join(fixture.configuration.mediaPath, 'images', 'team.png');
  await mkdir(path.dirname(imagePath), { recursive: true });
  await writeFile(imagePath, PNG);
  const provider = new FakeProvider();

  try {
    const first = await publishMedia({ configuration: fixture.configuration, provider });
    assert.deepEqual(first, { ok: true, new: 1, updated: 0, unchanged: 0, remoteOnly: 0, failed: 0 });
    assert.equal(provider.uploads.length, 1);
    assert.equal(provider.uploads[0].objectKey, 'media/images/team.png');
    assert.equal(provider.uploads[0].contentType, 'image/png');
    assert.equal(provider.uploads[0].cacheControl, MEDIA_CACHE_CONTROL);

    const unchanged = await publishMedia({ configuration: fixture.configuration, provider });
    assert.equal(unchanged.unchanged, 1);
    assert.equal(provider.uploads.length, 1);

    await writeFile(imagePath, Buffer.concat([PNG, Buffer.from('edited')]));
    const edited = await publishMedia({ configuration: fixture.configuration, provider });
    assert.equal(edited.updated, 1);
    assert.equal(provider.uploads.length, 2);

    await unlink(imagePath);
    const remoteOnly = await publishMedia({ configuration: fixture.configuration, provider });
    assert.equal(remoteOnly.remoteOnly, 1);
    const manifest = await readManifest(fixture.configuration.manifestPath, 'media');
    assert.ok(manifest.files['media/images/team.png']);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('dry runs classify media without provider access or manifest writes', async () => {
  const fixture = await createFixture();
  await writeFile(path.join(fixture.configuration.mediaPath, 'new.png'), PNG);
  try {
    const result = await publishMedia({ configuration: fixture.configuration, dryRun: true });
    assert.equal(result.new, 1);
    await assert.rejects(readFile(fixture.configuration.manifestPath), { code: 'ENOENT' });
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('unchanged bytes republish when the remote provider target changes', async () => {
  const fixture = await createFixture();
  await writeFile(path.join(fixture.configuration.mediaPath, 'target.png'), PNG);
  const provider = new FakeProvider();
  try {
    await publishMedia({ configuration: fixture.configuration, provider });
    const movedConfiguration = {
      ...fixture.configuration,
      bucket: 'replacement-bucket',
      endpoint: 'https://replacement.r2.cloudflarestorage.com',
      region: 'auto'
    };
    const result = await publishMedia({ configuration: movedConfiguration, provider });
    assert.equal(result.updated, 1);
    assert.equal(provider.uploads.length, 2);
    const manifest = await readManifest(movedConfiguration.manifestPath, 'media');
    assert.equal(manifest.files['media/target.png'].bucket, 'replacement-bucket');
    assert.equal(manifest.files['media/target.png'].endpoint, movedConfiguration.endpoint);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('failed publication preserves the previous valid manifest and local files', async () => {
  const fixture = await createFixture();
  const firstPath = path.join(fixture.configuration.mediaPath, 'first.png');
  const secondPath = path.join(fixture.configuration.mediaPath, 'second.png');
  await writeFile(firstPath, PNG);
  try {
    await publishMedia({ configuration: fixture.configuration, provider: new FakeProvider() });
    const before = await readFile(fixture.configuration.manifestPath, 'utf8');
    await writeFile(secondPath, PNG);
    await assert.rejects(
      publishMedia({ configuration: fixture.configuration, provider: new FakeProvider({ fail: true }) }),
      (error) => error.result?.failed === 1 && /simulated remote mismatch/.test(error.message)
    );
    assert.equal(await readFile(fixture.configuration.manifestPath, 'utf8'), before);
    assert.deepEqual(await readFile(secondPath), PNG);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('publisher rejects symlinks and unrecognized content', async () => {
  const fixture = await createFixture();
  const outsidePath = path.join(fixture.appRootPath, 'outside.png');
  await writeFile(outsidePath, PNG);
  try {
    await symlink(outsidePath, path.join(fixture.configuration.mediaPath, 'linked.png'));
    await assert.rejects(
      publishMedia({ configuration: fixture.configuration, dryRun: true }),
      /Symbolic links are not allowed/
    );
    await unlink(path.join(fixture.configuration.mediaPath, 'linked.png'));
    await writeFile(path.join(fixture.configuration.mediaPath, 'fake.jpg'), 'not an image');
    await assert.rejects(
      publishMedia({ configuration: fixture.configuration, dryRun: true }),
      /Unsupported or unrecognized media type/
    );
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('publication lock prevents concurrent publishers in one checkout', async () => {
  const fixture = await createFixture();
  let release;
  try {
    release = await acquirePublicationLock(fixture.configuration.lockPath);
    await assert.rejects(
      acquirePublicationLock(fixture.configuration.lockPath),
      /Another media publication is active/
    );
    await release();
    release = null;
    const secondRelease = await acquirePublicationLock(fixture.configuration.lockPath);
    await secondRelease();
  } finally {
    if (release) await release();
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('publisher configuration has no legacy aliases and derives custom active-space paths', () => {
  const configuration = createPublisherConfiguration({
    settings: {
      appRootPath: '/srv/site',
      activeSpace: 'spaces/green',
      publicLocation: 'web',
      mediaLocation: 'media',
      mediaCdnFallback: false,
      mediaCdnBaseUrl: ''
    },
    env: {
      MEDIA_PUBLISH_ENABLED: 'true',
      MEDIA_PUBLISH_BUCKET: 'site-media',
      MEDIA_PUBLISH_REGION: 'auto',
      MEDIA_PUBLISH_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      MEDIA_PUBLISH_ACCESS_KEY_ID: 'media-access-key',
      MEDIA_PUBLISH_SECRET_ACCESS_KEY: 'media-secret-key'
    }
  });
  assert.equal(configuration.manifestPath, '/srv/site/spaces/green/.altair/media-publication.json');
  assert.equal(configuration.mediaPath, '/srv/site/spaces/green/web/media');
  assert.equal(configuration.provider, 's3-compatible');
  assert.deepEqual(configuration.credentials, {
    accessKeyId: 'media-access-key',
    secretAccessKey: 'media-secret-key'
  });
  assert.throws(() => createPublisherConfiguration({
    settings: {
      appRootPath: '/srv/site', activeSpace: 'spaces/green', publicLocation: 'web',
      mediaLocation: 'media', mediaCdnFallback: false, mediaCdnBaseUrl: ''
    },
    env: { MEDIA_PUBLISH_ENABLED: 'true', MEDIA_PUBLISH_PROVIDER: 'r2' }
  }), /s3-compatible/);
  assert.throws(() => createPublisherConfiguration({
    settings: {
      appRootPath: '/srv/site', activeSpace: 'spaces/green', publicLocation: 'web',
      mediaLocation: 'media', mediaCdnFallback: false, mediaCdnBaseUrl: ''
    },
    env: {
      MEDIA_PUBLISH_ENABLED: 'true', MEDIA_PUBLISH_PROVIDER: 's3-compatible',
      MEDIA_PUBLISH_BUCKET: 'site-media', MEDIA_PUBLISH_REGION: 'auto'
    }
  }), /MEDIA_PUBLISH_ACCESS_KEY_ID/);
});

test('credential redaction handles prefix-related and regex-significant secrets', () => {
  const output = redactSensitiveValues(
    'short=abc long=abcdef symbols=a.b$c and repeat=abcdef',
    ['abc', 'abcdef', 'a.b$c']
  );

  assert.equal(
    output,
    'short=[REDACTED] long=[REDACTED] symbols=[REDACTED] and repeat=[REDACTED]'
  );
});
