const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

export function formatMoney(amount: number): string {
    return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} đồng`;
}

export function formatFineRange(fine: { min: number; max: number } | null): string {
    if (!fine) {
        return "Chưa đọc được mức phạt";
    }

    if (fine.min === fine.max) {
        return formatMoney(fine.min);
    }

    return `${formatMoney(fine.min)} – ${formatMoney(fine.max)}`;
}

/** 2022-01-01 → 01/01/2022; anything that is not an ISO date is returned unchanged. */
export function formatDate(value: string | null): string {
    if (!value) {
        return "Chưa rõ";
    }

    const match = ISO_DATE.exec(value);

    if (!match) {
        return value;
    }

    return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatPeriod(validFrom: string | null, validTo: string | null): string {
    const from = validFrom ? formatDate(validFrom) : "chưa rõ";

    if (!validTo) {
        return `Từ ${from}, chưa có ngày kết thúc trong dữ liệu`;
    }

    return `Từ ${from} đến ${formatDate(validTo)}`;
}

export function todayIso(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
}

/** Renders a before/after value of a semantic change event for people; objects with a fine range read as money. */
export function describeChangeValue(value: unknown): string {
    if (value === null || value === undefined) {
        return "không có";
    }

    if (typeof value === "string") {
        return value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }

    if (Array.isArray(value)) {
        return value.length === 0 ? "không có" : value.map(describeChangeValue).join("; ");
    }

    if (typeof value === "object" && "min" in value && "max" in value && typeof value.min === "number" && typeof value.max === "number") {
        return formatFineRange({ min: value.min, max: value.max });
    }

    return JSON.stringify(value);
}
