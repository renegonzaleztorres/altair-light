import { createReadStream } from 'node:fs';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const verifyRemoteMetadata = (remote, { objectKey, size, contentType, sha256 }) => {
  if (remote.ContentLength !== size || remote.ContentType !== contentType ||
      remote.Metadata?.sha256 !== sha256) {
    throw new Error(`Remote verification failed for ${objectKey}`);
  }
};

class S3MediaProvider {

  constructor(configuration) {
    this.configuration = configuration;
    this.client = new S3Client({
      region: configuration.region,
      ...(configuration.endpoint ? { endpoint: configuration.endpoint } : {}),
      credentials: configuration.credentials,
      forcePathStyle: configuration.forcePathStyle,
      maxAttempts: 3
    });
  }

  async uploadAndVerify({ filePath, objectKey, size, contentType, sha256, cacheControl }) {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.configuration.bucket,
        Key: objectKey,
        Body: createReadStream(filePath),
        ContentLength: size,
        ContentType: contentType,
        CacheControl: cacheControl,
        Metadata: { sha256 }
      },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false
    });
    await upload.done();

    const remote = await this.client.send(new HeadObjectCommand({
      Bucket: this.configuration.bucket,
      Key: objectKey
    }));
    verifyRemoteMetadata(remote, { objectKey, size, contentType, sha256 });

    if (this.configuration.verifyPublic) await this.verifyPublicObject(objectKey, size);
  }

  async verifyPublicObject(objectKey, size) {
    if (!this.configuration.publicBaseUrl) {
      throw new Error('MEDIA_CDN_BASE_URL is required when MEDIA_PUBLISH_VERIFY_PUBLIC=true');
    }
    const url = new URL(this.configuration.publicBaseUrl);
    url.pathname = `/${objectKey.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`;
    let response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: AbortSignal.timeout(10000)
        });
      } catch (error) {
        response = null;
      }
      if (response?.ok) break;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
    }
    if (!response?.ok) throw new Error(`Public delivery verification failed for ${objectKey}`);
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) !== size) {
      throw new Error(`Public delivery size verification failed for ${objectKey}`);
    }
  }

  destroy() {
    this.client.destroy();
  }

}

export default S3MediaProvider;
export { verifyRemoteMetadata };
