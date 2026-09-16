// Vitest-only stand-in for the "server-only" package (aliased in
// vitest.config.ts). That package's own export map only resolves to a
// no-op under Next's "react-server" bundler condition (see
// node_modules/server-only/package.json); under plain Node/Vitest it
// unconditionally throws "This module cannot be imported from a Client
// Component module." CLAUDE.md documents dodging this by keeping
// webhook-handlers.ts free of the import entirely so tests/money can
// import it directly — this alias generalizes that same test-only carve-
// out to every other "server-only"-marked file (src/lib/supabase/service.ts
// and anything importing it) without touching their production code or
// Next's own bundling, which never sees this alias — only Vitest's
// resolver does.
export {};
