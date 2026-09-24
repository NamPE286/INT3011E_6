# Code conventions

* Use strict TypeScript. Prefer `unknown` plus narrowing at boundaries; do not introduce `any` or assertion-driven programming for untrusted data.

* Prefer explicit, readable code over clever or overly compact expressions. Use descriptive domain names, guard clauses, explicit return values, and small cohesive functions. Avoid vague names such as `data`, `helper`, or `processor` when a domain name is available.

* Prefer `const`. Use `let` only when reassignment is required. Do not use `var`. Declare variables close to where they are used, and keep closely related declarations together.

* Always use braces for control-flow blocks such as `if`, `else`, `for`, `while`, and `switch` branches where applicable. Do not use brace-less or one-line control-flow statements such as `if (condition) return`.

* Keep formatting visually spacious and organized by logical blocks. Use blank lines to separate distinct responsibilities or phases of a function, but do not insert blank lines mechanically every few lines.

* Leave a blank line before `return` or `break` when it terminates a preceding logical block. A trivial function whose body is only a return statement does not need an artificial leading blank line.

* After a completed control-flow block such as `if`, `for`, or `while`, leave a blank line when the following statement begins a separate logical step. Do not add one when the statements are tightly coupled and separating them would reduce readability.

* Use 4 spaces for indentation everywhere, including TypeScript, JavaScript, JSX, TSX, HTML, CSS, JSON, YAML, configuration files, and other source files. Do not use tab characters for indentation unless a file format explicitly requires them.

* Use conventional spacing: put a space after control-flow keywords, around binary operators, and after commas. Do not put a space before function-call or function-declaration parentheses.

* Keep lines reasonably short, but do not wrap expressions merely to satisfy an arbitrary column count. Break long calls, objects, conditions, or expressions when doing so makes their structure easier to understand. Avoid both excessively long lines and gratuitous vertical formatting.

* For multiline argument or option objects, prefer formatting that exposes meaningful options clearly instead of compressing many unrelated values onto one line.

* Use semantic HTML and native controls for interactive UI. Keep client-side boundaries and state as small as reasonably possible.

* Keep files cohesive. Review files near 300–400 effective lines and split files above 500 lines when responsibilities diverge. Do not split files purely to satisfy a line count, and do not create tiny fragments or dumping-ground `utils` files.

* Keep functions and components understandable in one reading. Split meaningful responsibilities, not arbitrary line ranges. Prefer guard clauses when they reduce nesting, but do not fragment straightforward logic into unnecessary abstractions.

* Avoid premature abstraction and over-engineering. Do not introduce factories, wrappers, generic helpers, service layers, or configuration machinery unless they solve a concrete recurring problem in the codebase.

* Use the repository's formatter, linter, compiler, and existing import/style conventions. Do not introduce a second styling or formatting system. Configure the existing tooling to enforce these conventions where practical instead of relying only on manual discipline.

* Keep diffs focused. Remove dead code made obsolete by the change, but do not refactor unrelated code.

## Style example

Prefer code shaped like this:

```ts
type UserProfile = {
    id: string;
    displayName: string;
    email: string | null;
};

type UserRecord = {
    id: string;
    displayName: string;
    email: string | null;
    isDisabled: boolean;
};

export async function getActiveUserProfile(userId: string): Promise<UserProfile | null> {
    const userRecord = await userRepository.findById(userId);

    if (!userRecord) {
        return null;
    }

    if (userRecord.isDisabled) {
        return null;
    }

    const normalizedEmail = normalizeEmail(userRecord.email);
    const profile = createUserProfile(userRecord, normalizedEmail);

    return profile;
}

function normalizeEmail(email: string | null): string | null {
    if (!email) {
        return null;
    }

    const normalizedEmail = email.trim().toLowerCase();

    return normalizedEmail;
}

function createUserProfile(userRecord: UserRecord, email: string | null): UserProfile {
    return {
        id: userRecord.id,
        displayName: userRecord.displayName,
        email,
    };
}

export function findFirstAvailableSlot(slots: readonly TimeSlot[]): TimeSlot | null {
    for (const slot of slots) {
        if (!slot.isAvailable) {
            continue;
        }

        if (slot.isBlocked) {
            continue;
        }

        return slot;
    }

    return null;
}
```

For JSX or HTML-like markup, use the same 4-space indentation:

```tsx
export function CalendarToolbar(): React.ReactElement {
    return (
        <header>
            <nav aria-label="Calendar controls">
                <button type="button">
                    Today
                </button>

                <button type="button">
                    Previous
                </button>

                <button type="button">
                    Next
                </button>
            </nav>
        </header>
    );
}
```

Avoid compressed styles like:

```ts
if (!user) return null;

for (const item of items) processItem(item);

const result = condition ? doSomething() : doSomethingElse();
```

Prefer structurally explicit code when control flow or domain logic is involved.
