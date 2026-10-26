export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(source: Record<string, unknown>, key: string): string | null {
    const value = source[key];

    return typeof value === "string" ? value : null;
}

export function readNumber(source: Record<string, unknown>, key: string): number | null {
    const value = source[key];

    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readStringList(source: Record<string, unknown>, key: string): string[] {
    const value = source[key];

    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((item): item is string => typeof item === "string");
}

/** Maps the rows that parse and skips the malformed ones, so one bad row does not hide a whole list. */
export function readRows<T>(source: Record<string, unknown>, key: string, parseRow: (row: Record<string, unknown>) => T | null): T[] {
    const value = source[key];

    if (!Array.isArray(value)) {
        return [];
    }

    const rows: T[] = [];

    for (const item of value) {
        const parsed = isRecord(item) ? parseRow(item) : null;

        if (parsed !== null) {
            rows.push(parsed);
        }
    }

    return rows;
}
