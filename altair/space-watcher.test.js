import assert from 'node:assert/strict';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import SpaceWatcher from './space-watcher.js';

const waitFor = async (predicate, timeoutMs = 2000) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for watcher');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test('space watcher batches rapid changes and detects atomic replacements', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'altair-space-watch-'));
  const targetPath = path.join(rootPath, 'page.html');
  const batches = [];
  await writeFile(targetPath, 'initial');
  const watcher = new SpaceWatcher({
    rootPath,
    quietMs: 30,
    maxBatchMs: 100,
    onBatch: async (batch) => {
      batches.push(batch);
      return true;
    }
  });

  try {
    watcher.snapshot = await watcher.buildSnapshot();
    await writeFile(targetPath, 'one');
    await writeFile(path.join(rootPath, 'other.html'), 'two');
    watcher.markDirty('page.html');
    watcher.markDirty('other.html');
    await waitFor(() => batches.length >= 1);
    assert.equal(batches.length, 1);

    const replacement = path.join(rootPath, 'replacement.html');
    await writeFile(replacement, 'replacement');
    await rename(replacement, targetPath);
    watcher.markDirty('page.html');
    await waitFor(() => batches.length >= 2);
    assert.equal(watcher.uncertain, false);
  } finally {
    watcher.close();
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('snapshot reconciliation detects a change and disabled reconciliation starts no timer', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'altair-space-reconcile-'));
  const targetPath = path.join(rootPath, 'page.html');
  let batches = 0;
  await writeFile(targetPath, 'initial');
  const watcher = new SpaceWatcher({
    rootPath,
    reconcileEnabled: false,
    onBatch: async () => {
      batches += 1;
      return true;
    }
  });

  try {
    await watcher.start();
    assert.equal(watcher.reconcileTimer, null);
    watcher.watcher.close();
    watcher.watcher = null;
    await writeFile(targetPath, 'changed-without-native-event');
    assert.equal(await watcher.reconcile(), true);
    assert.equal(batches, 1);
    assert.ok(watcher.snapshot.files instanceof Map);
  } finally {
    watcher.close();
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('maximum batch duration processes continuous events without waiting for quiet', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'altair-space-maximum-'));
  const watcher = new SpaceWatcher({
    rootPath,
    quietMs: 80,
    maxBatchMs: 60,
    onBatch: async () => true
  });

  try {
    watcher.snapshot = await watcher.buildSnapshot();
    const startedAt = Date.now();
    watcher.markDirty('one.html');
    await new Promise((resolve) => setTimeout(resolve, 20));
    watcher.markDirty('two.html');
    await new Promise((resolve) => setTimeout(resolve, 20));
    watcher.markDirty('three.html');
    await waitFor(() => watcher.dirty === false);
    assert.ok(Date.now() - startedAt < 120);
  } finally {
    watcher.close();
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('a rejected batch keeps the watcher uncertain and preserves pending paths', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'altair-space-reject-'));
  const watcher = new SpaceWatcher({
    rootPath,
    quietMs: 20,
    maxBatchMs: 50,
    onBatch: async () => false
  });

  try {
    watcher.snapshot = await watcher.buildSnapshot();
    watcher.markDirty('DATA.json');
    await waitFor(() => watcher.uncertain === true);
    assert.equal(watcher.dirty, true);
    assert.equal(watcher.pendingPaths.has('DATA.json'), true);
  } finally {
    watcher.close();
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('enabled reconciliation owns a configured recurring timer and close removes it', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'altair-space-timer-'));
  const watcher = new SpaceWatcher({
    rootPath,
    reconcileEnabled: true,
    reconcileMs: 5000
  });

  try {
    await watcher.start();
    assert.ok(watcher.reconcileTimer);
    watcher.close();
    assert.equal(watcher.reconcileTimer, null);
    assert.equal(watcher.snapshot, null);
  } finally {
    watcher.close();
    await rm(rootPath, { recursive: true, force: true });
  }
});
