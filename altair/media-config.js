import { path } from './dependencies.js';

const normalizeRelativeLocation = (value, name) => {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0') || value.includes('\\')) {
    throw new Error(`${name} must be a non-empty relative path`);
  }
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  const segments = trimmed.split('/');
  if (path.isAbsolute(value) || !trimmed || segments.some((segment) =>
    !segment || segment === '.' || segment === '..' || segment.startsWith('_')
  )) {
    throw new Error(`${name} must be a safe public relative path`);
  }
  return segments.join('/');
};

const assertDescendant = (root, candidate, name) => {
  if (!candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${name} must resolve inside ${root}`);
  }
};

const resolveMediaConfiguration = ({
  appRootPath,
  activeSpace,
  publicLocation,
  mediaLocation,
  mediaCdnFallback = false,
  mediaCdnBaseUrl = ''
} = {}) => {
  const normalizedPublicLocation = normalizeRelativeLocation(publicLocation, 'PUBLIC_LOCATION');
  const normalizedMediaLocation = normalizeRelativeLocation(mediaLocation, 'MEDIA_LOCATION');
  const activeSpacePath = path.resolve(appRootPath, activeSpace);
  const publicPath = path.resolve(activeSpacePath, normalizedPublicLocation);
  const mediaPath = path.resolve(publicPath, normalizedMediaLocation);
  assertDescendant(publicPath, mediaPath, 'MEDIA_LOCATION');

  let cdnBaseUrl = '';
  if (mediaCdnFallback) {
    let parsed;
    try {
      parsed = new URL(mediaCdnBaseUrl);
    } catch (error) {
      throw new Error('MEDIA_CDN_BASE_URL must be a valid URL when fallback is enabled');
    }
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !localHttp) {
      throw new Error('MEDIA_CDN_BASE_URL must use HTTPS outside local testing');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
      throw new Error('MEDIA_CDN_BASE_URL must be an origin without credentials, path, query, or fragment');
    }
    cdnBaseUrl = parsed.origin;
  }

  return {
    activeSpacePath,
    publicPath,
    mediaPath,
    manifestPath: path.join(activeSpacePath, '.altair', 'media-publication.json'),
    lockPath: path.join(activeSpacePath, '.altair', 'media-publication.lock'),
    mediaLocation: normalizedMediaLocation,
    mediaRelativePath: path.posix.join(normalizedPublicLocation, normalizedMediaLocation),
    mediaUrlPrefix: `/${normalizedMediaLocation}`,
    cdnBaseUrl
  };
};

const mediaRequestTarget = (requestUrl, mediaUrlPrefix) => {
  let url;
  try {
    url = new URL(requestUrl);
  } catch (error) {
    return null;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch (error) {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes('%') ||
      !decoded.startsWith(`${mediaUrlPrefix}/`) || decoded.endsWith('/')) return null;
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.startsWith('_'))) return null;
  const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join('/');
  return { pathname: `/${encodedPath}`, search: url.search };
};

const createMediaRedirectUrl = (baseUrl, target) => {
  const url = new URL(baseUrl);
  url.pathname = target.pathname;
  url.search = target.search;
  return url.toString();
};

export {
  createMediaRedirectUrl,
  mediaRequestTarget,
  normalizeRelativeLocation,
  resolveMediaConfiguration
};
