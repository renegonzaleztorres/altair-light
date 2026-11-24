import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { envReader } from '../config.js';
import { createCredentialProvider, readRoleSource } from './credentials.js';

const ROLE_JSON = { AccessKeyId: 'ASIAROLE', SecretAccessKey: 'role-secret', Token: 'role-token', Expiration: '2026-11-21T15:00:00Z' };

// endpoint : a fetch stand-in answering by "METHOD url", recording each request
const endpoint = (routes) => {
  const requests = [];
  const fetch = async (url, init = {}) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    requests.push({ key, headers: init.headers ?? {} });
    const answer = routes[key];
    if (answer === undefined) return new Response('not found', { status: 404 });
    return new Response(typeof answer === 'string' ? answer : JSON.stringify(answer));
  };
  return { fetch, requests };
};

test('fixed keys are returned as they are, without any request', async () => {
  const { fetch, requests } = endpoint({});
  const get = createCredentialProvider({ credentials: { accessKeyId: 'AKID', secretAccessKey: 's' }, fetch });
  assert.deepEqual(await get(), { accessKeyId: 'AKID', secretAccessKey: 's' });
  assert.equal(requests.length, 0);
});

test('an ECS task role comes from the container endpoint, cached until near expiry', async () => {
  const { fetch, requests } = endpoint({ 'GET http://169.254.170.2/v2/credentials/abc': ROLE_JSON });
  let now = Date.parse('2026-11-21T14:00:00Z');
  const get = createCredentialProvider({ role: { containerRelativeUri: '/v2/credentials/abc' }, fetch, now: () => now });
  const expected = { accessKeyId: 'ASIAROLE', secretAccessKey: 'role-secret', sessionToken: 'role-token' };
  assert.deepEqual(await Promise.all([get(), get()]), [expected, expected]);
  assert.equal(requests.length, 1);
  now = Date.parse('2026-11-21T14:50:00Z');
  await get();
  assert.equal(requests.length, 1);
  now = Date.parse('2026-11-21T14:56:00Z'); // within 5 minutes of expiry
  await get();
  assert.equal(requests.length, 2);
});

test('a full container URI sends its authorization token, from the variable or a file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'altair-aws-'));
  try {
    const tokenFile = path.join(directory, 'token');
    await writeFile(tokenFile, 'file-token\n');
    const { fetch, requests } = endpoint({ 'GET http://169.254.170.23/v1/credentials': ROLE_JSON });
    await createCredentialProvider({ role: { containerFullUri: 'http://169.254.170.23/v1/credentials', containerTokenFile: tokenFile }, fetch })();
    await createCredentialProvider({ role: { containerFullUri: 'http://169.254.170.23/v1/credentials', containerToken: 'env-token' }, fetch })();
    assert.deepEqual(requests.map((request) => request.headers.Authorization), ['file-token', 'env-token']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const remote = createCredentialProvider({ role: { containerFullUri: 'http://attacker.example/creds' }, fetch: endpoint({}).fetch });
  await assert.rejects(remote(), /must be https or a local container endpoint/);
});

test('an EC2 instance role comes from IMDSv2 with a session token', async () => {
  const base = 'http://169.254.169.254/latest/meta-data/iam/security-credentials/';
  const { fetch, requests } = endpoint({
    'PUT http://169.254.169.254/latest/api/token': 'imds-token',
    [`GET ${base}`]: 'web-server-role\n',
    [`GET ${base}web-server-role`]: { Code: 'Success', ...ROLE_JSON }
  });
  const credentials = await createCredentialProvider({ fetch })();
  assert.equal(credentials.accessKeyId, 'ASIAROLE');
  assert.equal(requests[0].headers['X-aws-ec2-metadata-token-ttl-seconds'], '21600');
  assert.equal(requests[1].headers['X-aws-ec2-metadata-token'], 'imds-token');
  assert.equal(requests[2].headers['X-aws-ec2-metadata-token'], 'imds-token');
});

test('with no keys and no role, the error says what to set', async () => {
  const unreachable = async () => { throw new Error('connect EHOSTUNREACH 169.254.169.254:80'); };
  await assert.rejects(createCredentialProvider({ fetch: unreachable })(),
    /no AWS credentials from the EC2 instance metadata service \(connect EHOSTUNREACH.*\)\. Set access keys, or run with an ECS task role or EC2 instance role/);
});

test('readRoleSource picks up only the platform variables that are set', () => {
  assert.deepEqual(readRoleSource(envReader({ AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/abc', OTHER: 'x' })),
    { containerRelativeUri: '/v2/credentials/abc' });
  assert.deepEqual(readRoleSource(envReader({})), {});
});
