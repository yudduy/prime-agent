import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPORT_DEFINITIONS = [
	{
		markdown: "campaign-v1.md",
		html: "campaign-v1.html",
		title: "Prime Agent verifier-separated autoresearch",
	},
	{
		markdown: "source-evidence-v1.md",
		html: "source-evidence-v1.html",
		title: "Prime Agent source evidence matrix",
	},
] as const;

const REPORT_CSS = "report.css";
const MANIFEST_NAME = "campaign-v1.sha256";
const EXPECTED_PANDOC_VERSION = "pandoc 3.10.2";
const MARKDOWN_LINK = /!?\[[^\]]*\]\(([^)]+)\)/g;
const EXTERNAL_REFERENCE = /^(?:[a-z][a-z0-9+.-]*:|#)/i;

export interface CampaignReportBundleOptions {
	repoRoot: string;
	reportDir: string;
	pandocExecutable?: string;
	expectedPandocVersion?: string;
}

export interface CampaignReportBundleResult {
	manifestPath: string;
	manifestEntries: number;
	pandocVersion: string;
}

function sha256(contents: Buffer | string): string {
	return createHash("sha256").update(contents).digest("hex");
}

function portablePath(path: string): string {
	return path.split(sep).join("/");
}

function assertInsideRepo(repoRoot: string, path: string): void {
	const repoRelative = relative(repoRoot, path);
	if (
		repoRelative === "" ||
		(!repoRelative.startsWith(`..${sep}`) && repoRelative !== ".." && !isAbsolute(repoRelative))
	) {
		return;
	}
	throw new Error(`Report reference escapes repository root: ${path}`);
}

function referenceTarget(rawTarget: string): string | null {
	const trimmed = rawTarget.trim();
	const target = trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed.split(/\s+/u)[0];
	if (!target || EXTERNAL_REFERENCE.test(target)) return null;
	return target.replace(/[?#].*$/u, "");
}

export function extractLocalReportReferences(markdown: string): string[] {
	const references = new Set<string>();
	for (const match of markdown.matchAll(MARKDOWN_LINK)) {
		const target = referenceTarget(match[1] ?? "");
		if (target && target !== MANIFEST_NAME) references.add(target);
	}
	return [...references].sort();
}

async function pandocVersion(executable: string): Promise<string> {
	const { stdout } = await execFileAsync(executable, ["--version"], { encoding: "utf8" });
	return stdout.split("\n", 1)[0]?.trim() ?? "";
}

async function requirePinnedPandoc(executable: string, expectedVersion: string): Promise<string> {
	const actual = await pandocVersion(executable);
	if (actual !== expectedVersion) {
		throw new Error(`Pandoc version mismatch: expected ${expectedVersion}, got ${actual || "empty output"}`);
	}
	return actual;
}

async function renderReport(
	reportDir: string,
	pandocExecutable: string,
	definition: (typeof REPORT_DEFINITIONS)[number],
	outputPath: string,
): Promise<void> {
	await execFileAsync(
		pandocExecutable,
		[
			definition.markdown,
			"--standalone",
			"--toc",
			"--css",
			REPORT_CSS,
			"--metadata",
			`title=${definition.title}`,
			"--output",
			outputPath,
		],
		{ cwd: reportDir, encoding: "utf8" },
	);
}

async function expectedManifest(
	options: CampaignReportBundleOptions,
	overrides: ReadonlyMap<string, Buffer> = new Map(),
): Promise<string> {
	const repoRoot = resolve(options.repoRoot);
	const reportDir = resolve(options.reportDir);
	assertInsideRepo(repoRoot, reportDir);
	const paths = new Set<string>([
		REPORT_CSS,
		...REPORT_DEFINITIONS.flatMap((definition) => [definition.markdown, definition.html]),
	]);

	for (const definition of REPORT_DEFINITIONS) {
		const markdown = await readFile(resolve(reportDir, definition.markdown), "utf8");
		for (const reference of extractLocalReportReferences(markdown)) {
			const absolute = resolve(reportDir, reference);
			assertInsideRepo(repoRoot, absolute);
			const portableReference = portablePath(relative(reportDir, absolute));
			if (overrides.has(portableReference)) {
				paths.add(portableReference);
				continue;
			}
			const metadata = await stat(absolute).catch((error: unknown) => {
				throw new Error(`Missing report reference ${reference}: ${String(error)}`);
			});
			if (metadata.isFile()) paths.add(portableReference);
		}
	}

	const lines: string[] = [];
	for (const path of [...paths].sort()) {
		if (path === MANIFEST_NAME) continue;
		const override = overrides.get(path);
		if (override) {
			lines.push(`${sha256(override)}  ${path}`);
			continue;
		}
		const absolute = resolve(reportDir, path);
		assertInsideRepo(repoRoot, absolute);
		const metadata = await stat(absolute);
		if (!metadata.isFile()) throw new Error(`Manifest input is not a file: ${path}`);
		lines.push(`${sha256(await readFile(absolute))}  ${path}`);
	}
	return `${lines.join("\n")}\n`;
}

async function renderExpectedHtml(
	options: CampaignReportBundleOptions,
	directory: string,
): Promise<Map<string, Buffer>> {
	const pandocExecutable = options.pandocExecutable ?? "pandoc";
	const rendered = new Map<string, Buffer>();
	for (const definition of REPORT_DEFINITIONS) {
		const outputPath = resolve(directory, definition.html);
		await renderReport(resolve(options.reportDir), pandocExecutable, definition, outputPath);
		rendered.set(definition.html, await readFile(outputPath));
	}
	return rendered;
}

export async function writeCampaignReportBundle(
	options: CampaignReportBundleOptions,
): Promise<CampaignReportBundleResult> {
	const reportDir = resolve(options.reportDir);
	const pandocExecutable = options.pandocExecutable ?? "pandoc";
	const expectedVersion = options.expectedPandocVersion ?? EXPECTED_PANDOC_VERSION;
	const actualPandocVersion = await requirePinnedPandoc(pandocExecutable, expectedVersion);
	const temporaryDirectory = await mkdtemp(resolve(reportDir, ".campaign-report-bundle-"));
	try {
		const rendered = await renderExpectedHtml(options, temporaryDirectory);
		const manifest = await expectedManifest(options, rendered);
		const temporaryManifest = resolve(temporaryDirectory, MANIFEST_NAME);
		await writeFile(temporaryManifest, manifest, { encoding: "utf8", mode: 0o600 });
		for (const definition of REPORT_DEFINITIONS) {
			const temporaryPath = resolve(temporaryDirectory, definition.html);
			await rename(temporaryPath, resolve(reportDir, definition.html));
		}
		await rename(temporaryManifest, resolve(reportDir, MANIFEST_NAME));
		return {
			manifestPath: resolve(reportDir, MANIFEST_NAME),
			manifestEntries: manifest.trimEnd().split("\n").length,
			pandocVersion: actualPandocVersion,
		};
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

export async function verifyCampaignReportBundle(
	options: CampaignReportBundleOptions,
): Promise<CampaignReportBundleResult> {
	const reportDir = resolve(options.reportDir);
	const pandocExecutable = options.pandocExecutable ?? "pandoc";
	const expectedVersion = options.expectedPandocVersion ?? EXPECTED_PANDOC_VERSION;
	const actualPandocVersion = await requirePinnedPandoc(pandocExecutable, expectedVersion);
	const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "prime-campaign-report-check-"));
	try {
		const rendered = await renderExpectedHtml(options, temporaryDirectory);
		for (const definition of REPORT_DEFINITIONS) {
			const actual = await readFile(resolve(reportDir, definition.html));
			const expected = rendered.get(definition.html);
			if (!expected || !actual.equals(expected)) {
				throw new Error(`${definition.html} is stale relative to ${definition.markdown}`);
			}
		}
		const expected = await expectedManifest(options);
		const actual = await readFile(resolve(reportDir, MANIFEST_NAME), "utf8");
		if (actual !== expected) throw new Error(`${MANIFEST_NAME} does not match the complete report bundle`);
		return {
			manifestPath: resolve(reportDir, MANIFEST_NAME),
			manifestEntries: expected.trimEnd().split("\n").length,
			pandocVersion: actualPandocVersion,
		};
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
	const mode = process.argv[2];
	if (mode !== "--check" && mode !== "--write") {
		throw new Error("Usage: campaign-report-bundle --check|--write");
	}
	if (process.argv.length !== 3) throw new Error("Campaign report bundle accepts exactly one argument");
	const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
	const reportDir = resolve(repoRoot, "research/autoresearch/reports");
	const result =
		mode === "--write"
			? await writeCampaignReportBundle({ repoRoot, reportDir })
			: await verifyCampaignReportBundle({ repoRoot, reportDir });
	console.log(JSON.stringify({ mode, ...result }));
}
