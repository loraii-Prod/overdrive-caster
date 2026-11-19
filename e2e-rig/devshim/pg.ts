export class Pool { constructor(_o?: unknown) {} async query(): Promise<never> { throw new Error('pg not available in the sandbox build'); } on() {} async end() {} async connect(): Promise<never> { throw new Error('pg not available'); } }
export default { Pool };
