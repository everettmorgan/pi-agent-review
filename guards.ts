export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export type CustomEntry = {
	type: 'custom';
	customType: string;
	data: unknown;
};

export function isCustomEntry(entry: unknown): entry is CustomEntry {
	return isRecord(entry) && entry.type === 'custom' && typeof entry.customType === 'string';
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
