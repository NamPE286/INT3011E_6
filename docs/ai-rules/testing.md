# Testing rules

- For behavior changes and bug fixes, use Red → Green → Refactor: write the smallest observable-behavior test first, confirm it fails for the expected reason, implement the minimum change, then refactor with tests green.
- Prefer pure unit tests, then component tests, integration tests, and end-to-end tests only when the behavior crosses a meaningful boundary.
- Test public behavior: returned values, visible behavior, requests, domain rules, mutations, and expected failures. Avoid private helpers, incidental DOM structure, call counts, and implementation details.
- Mock external boundaries such as network, database, time, or randomness; do not mock the function under test or internal helpers.
- Keep fixtures minimal and deterministic. Cover failure paths, malformed external data, cancellation/timeouts, and authorization where relevant.
- Do not weaken tests or types to make a check pass. Report validation that could not run.
