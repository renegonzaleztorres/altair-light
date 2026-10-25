import assert from 'node:assert/strict';
import test from 'node:test';

import RenderCache from './render-cache.js';

const entry = (body) => ({ body, etag: `W/"${body}"` });

test('render cache stores lazily and evicts the least recently used entry', () => {
  const cache = new RenderCache({ enabled: true, maxEntries: 2 });
  assert.equal(cache.get('/one'), null);
  assert.equal(cache.set('/one', entry('one'), cache.generation), true);
  assert.equal(cache.set('/two', entry('two'), cache.generation), true);

  assert.equal(cache.get('/one').body, 'one');
  assert.equal(cache.set('/three', entry('three'), cache.generation), true);
  assert.equal(cache.get('/two'), null);
  assert.equal(cache.get('/one').body, 'one');
  assert.equal(cache.get('/three').body, 'three');
  assert.equal(cache.stats().evictions, 1);
});

test('invalidation prevents an old render generation from being stored', () => {
  const cache = new RenderCache({ enabled: true });
  const generation = cache.generation;
  cache.set('/page', entry('old'), generation);
  cache.invalidateAll('test');

  assert.equal(cache.get('/page'), null);
  assert.equal(cache.set('/page', entry('stale'), generation), false);
  assert.equal(cache.stats().invalidations, 1);
});

test('in-flight renders are tracked and close clears all state', async () => {
  const cache = new RenderCache({ enabled: true });
  const promise = Promise.resolve(entry('page'));
  cache.setInFlight('/page', promise);
  assert.equal(cache.getInFlight('/page'), promise);
  assert.equal(cache.stats().coalesced, 1);
  assert.equal(cache.deleteInFlight('/page', promise), true);
  cache.set('/page', entry('page'), cache.generation);
  cache.close();
  assert.equal(cache.stats().entries, 0);
  assert.equal(cache.stats().inFlight, 0);
});

test('the first lookup after the local year boundary invalidates once', () => {
  let now = new Date(2026, 11, 31, 23, 59, 59).getTime();
  const cache = new RenderCache({ enabled: true, now: () => now });
  cache.set('/page', entry('2026'), cache.generation);

  assert.equal(cache.get('/page').body, '2026');
  now = new Date(2027, 0, 1, 0, 0, 1).getTime();
  assert.equal(cache.get('/page'), null);
  assert.equal(cache.stats().invalidations, 1);
  assert.equal(cache.get('/page'), null);
  assert.equal(cache.stats().invalidations, 1);
});

test('disabled cache does not allocate entry or in-flight maps', () => {
  const cache = new RenderCache({ enabled: false });
  assert.equal(cache.entries, null);
  assert.equal(cache.inFlight, null);
  assert.equal(cache.set('/page', entry('page'), cache.generation), false);
});
