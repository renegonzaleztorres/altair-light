import { loadSettings } from '../../settings.js';

try {
  const settings = loadSettings();
  console.log(JSON.stringify(settings));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
