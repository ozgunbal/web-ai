/**
 * Mobile-safe / universal export surface: schema + guardrail + policy + audit log.
 * Deliberately does NOT re-export intent-parser.ts (WebLLM-dependent, browser-only).
 *
 * DESIGN DECISION (not literal from spec — spec section 2 shows one flat
 * core/src/index.ts): splitting the export surface via package.json `exports`
 * (`.` here, `./web` for the full surface) means Metro/React Native never has
 * to resolve `@mlc-ai/web-llm`'s browser/WASM/worker code at all when bundling
 * the mobile app.
 */
export * from "./schema/intent";
export * from "./schema/policy";
export * from "./policy.config";
export * from "./guardrail";
export * from "./audit-log";
