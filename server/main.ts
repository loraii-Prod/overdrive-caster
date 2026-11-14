/**
 * Server entry: restore the durable show state (database / snapshot) BEFORE anything reads state.json, then start.
 */
import { restore, startPersistence } from './durable';

await restore();
await import('./index');
startPersistence();
