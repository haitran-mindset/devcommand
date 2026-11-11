/** Messages explicitly safe to return across IPC; raw OS/process errors stay private. */
export class PublicError extends Error {}
