export const encode = (_: unknown): Uint8Array => { throw new Error('msgpack not available in the sandbox (use the JSON subprotocol)'); };
export const decode = (_: unknown): unknown => { throw new Error('msgpack not available'); };
