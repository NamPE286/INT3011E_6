# Engineering principles

Apply these priorities in order: safety and security, correctness, simplicity, readability, type safety, testability, maintainability, and performance for verified hot paths.

- Prefer boring, explicit, local code over clever or enterprise-style architecture.
- Keep presentation, domain logic, validation, persistence, and external integrations separate when the boundary removes real complexity.
- Keep business logic framework-independent where practical; framework code should orchestrate it.
- Prefer functions, plain objects, composition, and explicit inputs/outputs. Use classes or interfaces only for meaningful state, lifecycle, external boundaries, or multiple real implementations.
- Organize by feature/domain as complexity grows. Keep related code, tests, schemas, and integrations close together.
- Do not add speculative abstractions, generic layers, providers, flags, caches, retries, or configuration.
- Existing public contracts and repository conventions are authoritative unless the task intentionally changes them.
