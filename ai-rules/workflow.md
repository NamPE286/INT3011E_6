# Agent workflow and completion

1. Understand the requested observable behavior and inspect nearby code, tests, scripts, dependencies, and configuration.
2. Read version-matched framework or library documentation when behavior is uncertain.
3. Write or update tests first when technically feasible.
4. Implement the smallest coherent change and preserve established contracts.
5. Run relevant tests, type checking, linting, and formatting using repository scripts.
6. Review the diff for accidental secrets, generated churn, unrelated edits, unnecessary abstractions, and file-size or responsibility problems.
7. If the active git branch is not `main`, commit changes in logical parts. Do not push.

A change is complete only when the requested behavior is implemented, applicable tests and checks pass, security and accessibility were considered, and any validation gap is reported honestly.
