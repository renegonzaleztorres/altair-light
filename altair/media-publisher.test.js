import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
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
  constructor({ fail = false, failOnCall = 0, onUpload = null } = {}) {
    this.fail = fail;
    this.failOnCall = failOnCall;
    this.onUpload = onUpload;
    this.calls = 0;
    this.uploads = [];
  }

  async uploadAndVerify(file) {
    this.calls += 1;
    if (this.fail || this.calls === this.failOnCall) throw new Error('simulated remote mismatch');
    this.onUpload?.(file);
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

// exitedPid : the PID of a process that has already exited
const exitedPid = async () => {
  const child = spawn(process.execPath, ['-e', '']);
  await once(child, 'exit');
  return child.pid;
};

const writeLock = async (lockPath, owner) => {
  await mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(lockPath, `${JSON.stringify({ startedAt: '2026-11-03T00:00:00.000Z', ...owner })}\n`);
};

test('a lock left by a process that has exited is removed and taken over', async () => {
  const fixture = await createFixture();
  const { lockPath } = fixture.configuration;
  try {
    await writeLock(lockPath, { pid: await exitedPid(), hostname: os.hostname() });
    const release = await acquirePublicationLock(lockPath);
    assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).pid, process.pid);
    await release();

    // Same PID as this process, but not held by it: an earlier run (for example PID 1 in a container)
    await writeLock(lockPath, { pid: process.pid, hostname: os.hostname() });
    await (await acquirePublicationLock(lockPath))();
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('a lock held by a live process or another host is respected', async () => {
  const fixture = await createFixture();
  const { lockPath } = fixture.configuration;
  try {
    await writeLock(lockPath, { pid: process.ppid, hostname: os.hostname() });
    await assert.rejects(acquirePublicationLock(lockPath), new RegExp(`Another media publication is active \\(PID ${process.ppid}`));

    await writeLock(lockPath, { pid: await exitedPid(), hostname: 'another-host' });
    await assert.rejects(acquirePublicationLock(lockPath), /Another media publication is active/);

    await writeFile(lockPath, 'not json');
    await assert.rejects(acquirePublicationLock(lockPath), /Delete it only if no publication is running/);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('a failure partway through records the uploads that already succeeded', async () => {
  const fixture = await createFixture();
  await writeFile(path.join(fixture.configuration.mediaPath, 'a.png'), PNG);
  await writeFile(path.join(fixture.configuration.mediaPath, 'b.png'), PNG);
  try {
    const provider = new FakeProvider({ failOnCall: 2 });
    await assert.rejects(publishMedia({ configuration: fixture.configuration, provider }), /simulated remote mismatch/);
    const manifest = await readManifest(fixture.configuration.manifestPath, fixture.configuration.mediaLocation);
    assert.deepEqual(Object.keys(manifest.files), [provider.uploads[0].objectKey]);

    const retry = new FakeProvider();
    const result = await publishMedia({ configuration: fixture.configuration, provider: retry });
    assert.equal(retry.uploads.length, 1);
    assert.equal(result.unchanged, 1);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('an abort stops before the next file and keeps finished uploads', async () => {
  const fixture = await createFixture();
  await writeFile(path.join(fixture.configuration.mediaPath, 'a.png'), PNG);
  await writeFile(path.join(fixture.configuration.mediaPath, 'b.png'), PNG);
  const controller = new AbortController();
  try {
    const provider = new FakeProvider({ onUpload: (file) => {
      assert.equal(file.signal, controller.signal);
      controller.abort(new Error('Interrupted by SIGINT'));
    } });
    await assert.rejects(
      publishMedia({ configuration: fixture.configuration, provider, signal: controller.signal }),
      /Interrupted by SIGINT/
    );
    assert.equal(provider.uploads.length, 1);
    const manifest = await readManifest(fixture.configuration.manifestPath, fixture.configuration.mediaLocation);
    assert.equal(Object.keys(manifest.files).length, 1);
  } finally {
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
