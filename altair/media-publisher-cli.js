import { parseArgs } from 'node:util';
import {
  __ACTIVE_SPACE,
  __MEDIA_LOCATION,
  __PUBLIC_LOCATION,
  __appRootPath
} from './constants.js';
import {
  acquirePublicationLock,
  createPublisherConfiguration,
  publishMedia,
  redactSensitiveValues
} from './media-publisher.js';

const usage = `Altair media publisher

Usage:
  pnpm media:publish
  pnpm media:publish -- --dry-run
  pnpm media:publish -- --json

Options:
  --dry-run  Inspect and classify without remote changes
  --json     Emit one structured JSON result
  --help     Show this help
`;

const redact = (value) => {
  const output = redactSensitiveValues(value, [
    'MEDIA_PUBLISH_ACCESS_KEY_ID',
    'MEDIA_PUBLISH_SECRET_ACCESS_KEY',
    'MEDIA_PUBLISH_SESSION_TOKEN'
  ].map((name) => process.env[name]));
  return output.replace(/https?:\/\/[^\s]*[?&](?:X-Amz-|Signature)[^\s]*/gi, '[REDACTED_URL]');
};

const printHumanResult = (result, { dryRun }) => {
  console.log(dryRun ? 'Media publication dry run complete.' : 'Media publication complete.');
  console.log(`New: ${result.new}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Unchanged: ${result.unchanged}`);
  console.log(`Remote-only: ${result.remoteOnly}`);
  console.log(`Failed: ${result.failed}`);
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const { values } = parseArgs({
    args,
    options: {
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false }
    },
    strict: true
  });
  if (values.help) {
    console.log(usage);
    return;
  }

  const configuration = createPublisherConfiguration({
    settings: {
      appRootPath: __appRootPath,
      activeSpace: __ACTIVE_SPACE,
      publicLocation: __PUBLIC_LOCATION,
      mediaLocation: __MEDIA_LOCATION,
      mediaCdnFallback: false,
      mediaCdnBaseUrl: ''
    }
  });
  const releaseLock = await acquirePublicationLock(configuration.lockPath);
  let provider;
  try {
    if (!values['dry-run']) {
      const { default: S3MediaProvider } = await import('./media-provider-s3.js');
      provider = new S3MediaProvider(configuration);
    }
    const result = await publishMedia({
      configuration,
      provider,
      dryRun: values['dry-run']
    });
    if (values.json) console.log(JSON.stringify(result));
    else printHumanResult(result, { dryRun: values['dry-run'] });
  } finally {
    provider?.destroy();
    await releaseLock();
  }
};

try {
  await main();
} catch (error) {
  const result = {
    ok: false,
    ...(error.result || { new: 0, updated: 0, unchanged: 0, remoteOnly: 0, failed: 1 }),
    error: redact(error.message)
  };
  if (process.argv.includes('--json')) console.log(JSON.stringify(result));
  else console.error(`Media publication failed: ${result.error}`);
  process.exitCode = 1;
}
