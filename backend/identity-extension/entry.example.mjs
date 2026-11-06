// Apply only in a separately reviewed identity Worker checkout AFTER backup.
// Existing src/worker.js remains intact; point wrangler main at this wrapper.
import browserWorker from './worker.js';
import { withMobileIdentity } from './mobile-extension.mjs';
export default withMobileIdentity(browserWorker);
