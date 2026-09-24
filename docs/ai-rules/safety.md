# Safety and boundaries

- Treat external input and provider responses as untrusted. Validate at system boundaries and authorize every client-referenced resource server-side.
- Never expose secrets, tokens, private keys, credentials, complete authorization headers, or sensitive user data in source, logs, tests, or client bundles.
- Handle expected failures explicitly. Do not silently swallow errors or leak implementation details to users.
- Treat external systems as unreliable: handle relevant authentication failures, malformed responses, network failures, timeouts, rate limits, retries, and idempotency deliberately.
- Keep side effects near system boundaries. Make core calculations and domain rules deterministic where practical.
- Do not mutate production or production configuration manually. Verify environment and target before remote mutations; prefer local resources for tests.
