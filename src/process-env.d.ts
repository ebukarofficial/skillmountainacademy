// lib/config.ts reads build-time website values from process.env; wrangler.jsonc "define" replaces them with "".
declare const process: { env: Record<string, string | undefined> };
