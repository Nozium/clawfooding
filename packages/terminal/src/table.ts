import pc from "picocolors";

interface Column {
	header: string;
	width: number;
	align: "left" | "right";
}

interface TableOptions {
	columns: Column[];
	title?: string;
}

/**
 * Minimal responsive table renderer for terminal output.
 * Adapts to terminal width and supports alignment.
 */
export class Table {
	private columns: Column[];
	private rows: string[][] = [];
	private title?: string;

	constructor(options: TableOptions) {
		this.columns = options.columns;
		this.title = options.title;
	}

	addRow(values: string[]): void {
		this.rows.push(values);
	}

	addSeparator(): void {
		this.rows.push([]);
	}

	render(): string {
		const termWidth = process.stdout.columns ?? 80;
		const adjustedColumns = this.adjustColumnWidths(termWidth);
		const lines: string[] = [];

		if (this.title) {
			lines.push("");
			lines.push(pc.bold(this.title));
			lines.push("");
		}

		// Header
		const headerLine = adjustedColumns
			.map((col) => padCell(pc.bold(pc.underline(col.header)), col.width, col.align))
			.join("  ");
		lines.push(headerLine);

		// Rows
		for (const row of this.rows) {
			if (row.length === 0) {
				lines.push(adjustedColumns.map((col) => "─".repeat(col.width)).join("──"));
				continue;
			}
			const cells = adjustedColumns.map((col, i) =>
				padCell(row[i] ?? "", col.width, col.align),
			);
			lines.push(cells.join("  "));
		}

		lines.push("");
		return lines.join("\n");
	}

	private adjustColumnWidths(termWidth: number): Column[] {
		const totalDesired = this.columns.reduce((sum, col) => sum + col.width, 0);
		const gaps = (this.columns.length - 1) * 2;
		const available = termWidth - gaps;

		if (totalDesired <= available) return this.columns;

		const ratio = available / totalDesired;
		return this.columns.map((col) => ({
			...col,
			width: Math.max(Math.floor(col.width * ratio), col.header.length),
		}));
	}
}

function padCell(text: string, width: number, align: "left" | "right"): string {
	// Strip ANSI codes for length calculation
	const stripped = text.replace(/\x1B\[\d+m/g, "");
	const diff = width - stripped.length;
	if (diff <= 0) return text;

	if (align === "right") {
		return " ".repeat(diff) + text;
	}
	return text + " ".repeat(diff);
}

/**
 * Render a key-value summary block.
 */
export function renderSummary(entries: Array<[string, string]>): string {
	const maxKeyLen = Math.max(...entries.map(([key]) => key.length));
	const lines = entries.map(
		([key, value]) => `  ${pc.dim(key.padEnd(maxKeyLen))}  ${value}`,
	);
	return lines.join("\n");
}
