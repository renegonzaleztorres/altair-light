import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { fileTypeFromFile } from 'file-type';
import { fs, path } from './dependencies.js';
import { resolveMediaConfiguration } from './media-config.js';

const MANIFEST_SCHEMA_VERSION = 1;
const MEDIA_CACHE_CONTROL = 'public, max-age=300, must-revalidate';
const MAX_MEDIA_FILE_BYTES = 20 * (1024 ** 3);
const ALLOWED_MEDIA_TYPES = new Set([
  'image/avif', 'image/bmp', 'image/gif', 'image/jpeg', 'image/png', 'image/tiff', 'image/webp',
  'audio/aac', 'audio/flac', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
  'application/pdf'
]);
const IGNORED_FILE_NAMES = new Set(['.DS_Store', '.gitkeep', 'Thumbs.db']);

const isSafeObjectKey = (objectKey, mediaLocation) => {
  if (typeof objectKey !== 'string' || !objectKey.startsWith(`${mediaLocation}/`) ||
      Buffer.byteLength(objectKey, 'utf8') > 1024 || /[\u0000-\u001f\u007f%\\]/.test(objectKey)) return false;
  const segments = objectKey.split('/');
  return !segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('_'));
};

const envBoolean = (env, name, fallback = false) => {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
};

const validateRemoteUrl = (value, name, { allowEmpty = false } = {}) => {
  if (!value && allowEmpty) return '';
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${name} must be a valid URL`);
  }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) throw new Error(`${name} must use HTTPS outside local testing`);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, query parameters, or a fragment`);
  }
  return url.toString().replace(/\/$/, '');
};

const createPublisherConfiguration = ({ settings, env = process.env } = {}) => {
  const paths = resolveMediaConfiguration(settings);
  if (!envBoolean(env, 'MEDIA_PUBLISH_ENABLED', false)) {
    throw new Error('Media publishing is disabled; set MEDIA_PUBLISH_ENABLED=true to use the publisher');
  }
  const provider = env.MEDIA_PUBLISH_PROVIDER || 's3-compatible';
  if (provider !== 's3-compatible') throw new Error('MEDIA_PUBLISH_PROVIDER must be s3-compatible');
  const bucket = (env.MEDIA_PUBLISH_BUCKET || '').trim();
  if (!bucket || /[\u0000-\u001f\u007f]/.test(bucket)) throw new Error('MEDIA_PUBLISH_BUCKET is required');
  const region = (env.MEDIA_PUBLISH_REGION || '').trim();
  if (!region) throw new Error('MEDIA_PUBLISH_REGION is required');
  const endpoint = validateRemoteUrl(env.MEDIA_PUBLISH_ENDPOINT || '', 'MEDIA_PUBLISH_ENDPOINT', { allowEmpty: true });
  const publicBaseUrl = validateRemoteUrl(env.MEDIA_CDN_BASE_URL || '', 'MEDIA_CDN_BASE_URL', { allowEmpty: true });
  const accessKeyId = env.MEDIA_PUBLISH_ACCESS_KEY_ID || '';
  const secretAccessKey = env.MEDIA_PUBLISH_SECRET_ACCESS_KEY || '';
  const sessionToken = env.MEDIA_PUBLISH_SESSION_TOKEN || '';
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('MEDIA_PUBLISH_ACCESS_KEY_ID and MEDIA_PUBLISH_SECRET_ACCESS_KEY are required');
  }

  const verifyPublic = envBoolean(env, 'MEDIA_PUBLISH_VERIFY_PUBLIC', false);
  if (verifyPublic && !publicBaseUrl) {
    throw new Error('MEDIA_CDN_BASE_URL is required when MEDIA_PUBLISH_VERIFY_PUBLIC=true');
  }

  return {
    ...paths,
    provider,
    bucket,
    region,
    endpoint,
    publicBaseUrl,
    credentials: {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {})
    },
    verifyPublic,
    forcePathStyle: envBoolean(env, 'MEDIA_PUBLISH_FORCE_PATH_STYLE', false),
    cacheControl: MEDIA_CACHE_CONTROL
  };
};

const emptyManifest = (mediaLocation) => ({
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  mediaLocation,
  files: {}
});

const validateManifest = (manifest, mediaLocation) => {
  if (!manifest || manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
      manifest.mediaLocation !== mediaLocation || !manifest.files ||
      typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('The media publication manifest is invalid or incompatible');
  }
  for (const [key, entry] of Object.entries(manifest.files)) {
    if (!isSafeObjectKey(key, mediaLocation) || !entry || typeof entry !== 'object' ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 1 ||
        typeof entry.contentType !== 'string' || entry.objectKey !== key ||
        typeof entry.provider !== 'string' || typeof entry.bucket !== 'string' ||
        typeof entry.endpoint !== 'string' || typeof entry.region !== 'string') {
      throw new Error(`Invalid media publication manifest entry: ${key}`);
    }
  }
  return manifest;
};

const readManifest = async (manifestPath, mediaLocation) => {
  try {
    const stats = await fs.stat(manifestPath);
    if (stats.size > 10 * 1024 * 1024) throw new Error('The media publication manifest is too large');
    const content = await fs.readFile(manifestPath, 'utf8');
    return validateManifest(JSON.parse(content), mediaLocation);
  } catch (error) {
    if (error.code === 'ENOENT') return emptyManifest(mediaLocation);
    if (error instanceof SyntaxError) throw new Error('The media publication manifest is not valid JSON');
    throw error;
  }
};

const writeManifestAtomic = async (manifestPath, manifest) => {
  const directory = path.dirname(manifestPath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporaryPath, manifestPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
};

const hashFile = (filePath) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  stream.on('error', reject);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
});

const shouldIgnoreFile = (name) =>
  IGNORED_FILE_NAMES.has(name) || name.endsWith('~') || name.endsWith('.swp') || name.endsWith('.tmp');

async function* walkMedia(directoryPath, relativeDirectory = '') {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (shouldIgnoreFile(entry.name)) continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in managed media: ${relativePath}`);
    if (entry.isDirectory()) {
      yield* walkMedia(absolutePath, relativePath);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Unsupported media filesystem entry: ${relativePath}`);
    yield { absolutePath, relativePath };
  }
}

const inspectMediaFile = async ({ absolutePath, relativePath }, mediaLocation) => {
  const normalizedRelativePath = relativePath.split(path.sep).join('/');
  const objectKey = path.posix.join(mediaLocation, normalizedRelativePath);
  if (!isSafeObjectKey(objectKey, mediaLocation)) {
    throw new Error(`Unsafe media object key: ${relativePath}`);
  }
  const before = await fs.stat(absolutePath);
  if (!before.isFile() || before.size === 0) throw new Error(`Media file must be a non-empty regular file: ${relativePath}`);
  if (before.size > MAX_MEDIA_FILE_BYTES) throw new Error(`Media file exceeds the provider size limit: ${relativePath}`);
  const detected = await fileTypeFromFile(absolutePath);
  if (!detected || !ALLOWED_MEDIA_TYPES.has(detected.mime)) {
    throw new Error(`Unsupported or unrecognized media type: ${relativePath}`);
  }
  const sha256 = await hashFile(absolutePath);
  const after = await fs.stat(absolutePath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
    throw new Error(`Media file changed while it was being inspected: ${relativePath}`);
  }
  return {
    filePath: absolutePath,
    objectKey,
    size: after.size,
    modifiedTimeMs: after.mtimeMs,
    ino: after.ino,
    contentType: detected.mime,
    sha256
  };
};

const assertMediaContainment = async (configuration) => {
  await fs.mkdir(configuration.mediaPath, { recursive: true });
  const [publicRealPath, mediaRealPath] = await Promise.all([
    fs.realpath(configuration.publicPath),
    fs.realpath(configuration.mediaPath)
  ]);
  if (!mediaRealPath.startsWith(`${publicRealPath}${path.sep}`)) {
    throw new Error('MEDIA_LOCATION resolves outside PUBLIC_LOCATION');
  }
};

const sortManifestFiles = (files) => Object.fromEntries(
  Object.entries(files).sort(([left], [right]) => left.localeCompare(right))
);

const publishMedia = async ({ configuration, provider = null, dryRun = false, now = () => new Date() } = {}) => {
  await assertMediaContainment(configuration);
  const manifest = await readManifest(configuration.manifestPath, configuration.mediaLocation);
  const nextFiles = { ...manifest.files };
  const result = { ok: true, new: 0, updated: 0, unchanged: 0, remoteOnly: 0, failed: 0 };
  const localKeys = new Set();
  let changed = false;

  try {
    for await (const discovered of walkMedia(configuration.mediaPath)) {
      const file = await inspectMediaFile(discovered, configuration.mediaLocation);
      localKeys.add(file.objectKey);
      const previous = manifest.files[file.objectKey];
      if (previous && previous.sha256 === file.sha256 && previous.size === file.size &&
          previous.contentType === file.contentType && previous.provider === configuration.provider &&
          previous.bucket === configuration.bucket && previous.endpoint === configuration.endpoint &&
          previous.region === configuration.region) {
        result.unchanged += 1;
        continue;
      }

      const classification = previous ? 'updated' : 'new';
      result[classification] += 1;
      if (dryRun) continue;
      if (!provider || typeof provider.uploadAndVerify !== 'function') {
        throw new Error('A media provider is required for publication');
      }
      await provider.uploadAndVerify({ ...file, cacheControl: configuration.cacheControl });
      const afterUpload = await fs.stat(file.filePath);
      if (afterUpload.size !== file.size || afterUpload.mtimeMs !== file.modifiedTimeMs || afterUpload.ino !== file.ino) {
        throw new Error(`Media file changed while it was being published: ${file.objectKey}`);
      }
      nextFiles[file.objectKey] = {
        sha256: file.sha256,
        size: file.size,
        contentType: file.contentType,
        provider: configuration.provider,
        bucket: configuration.bucket,
        endpoint: configuration.endpoint,
        region: configuration.region,
        objectKey: file.objectKey,
        publishedAt: now().toISOString()
      };
      changed = true;
    }
  } catch (error) {
    result.ok = false;
    result.failed += 1;
    error.result = result;
    throw error;
  }

  result.remoteOnly = Object.keys(manifest.files).filter((key) => !localKeys.has(key)).length;
  if (!dryRun && changed) {
    await writeManifestAtomic(configuration.manifestPath, {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      mediaLocation: configuration.mediaLocation,
      files: sortManifestFiles(nextFiles)
    });
  }
  return result;
};

const acquirePublicationLock = async (lockPath) => {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await fs.open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
  } catch (error) {
    if (handle) await handle.close();
    if (handle) await fs.rm(lockPath, { force: true });
    if (error.code === 'EEXIST') throw new Error(`Another media publication is active; lock exists at ${lockPath}`);
    throw error;
  }
  return async () => {
    await handle.close();
    await fs.rm(lockPath, { force: true });
  };
};

export {
  ALLOWED_MEDIA_TYPES,
  MANIFEST_SCHEMA_VERSION,
  MAX_MEDIA_FILE_BYTES,
  MEDIA_CACHE_CONTROL,
  acquirePublicationLock,
  createPublisherConfiguration,
  inspectMediaFile,
  publishMedia,
  readManifest,
  writeManifestAtomic
};
