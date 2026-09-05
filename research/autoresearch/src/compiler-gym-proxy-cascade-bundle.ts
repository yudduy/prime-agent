import { mkdir, open, readFile, rmdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export interface CompilerGymProxyCascadeBundlePaths {
	repoRoot: string;
	bundleDirectory: string;
	resultPath: string;
	manifestPath: string;
}

export interface CompilerGymProxyCascadeBundleWriteInput extends CompilerGymProxyCascadeBundlePaths {
	resultContents: string;
	manifestContents: string;
}

export interface CompilerGymProxyCascadeBundleWriteHooks {
	beforeFileWrite?(path: string, ordinal: 1 | 2): Promise<void>;
}

function assertInsideRepo(repoRoot: string, path: string, label: string): void {
	const repoRelative = relative(repoRoot, path);
	if (
		repoRelative === "" ||
		isAbsolute(repoRelative) ||
		repoRelative === ".." ||
		repoRelative.startsWith("../") ||
		repoRelative.startsWith("..\\")
	) {
		throw new Error(`${label} must be a file strictly inside the repository root`);
	}
}

export function resolveCompilerGymProxyCascadeBundlePaths(input: {
	repoRoot: string;
	resultPath: string;
	manifestPath: string;
}): CompilerGymProxyCascadeBundlePaths {
	const repoRoot = resolve(input.repoRoot);
	const resultPath = resolve(repoRoot, input.resultPath);
	const manifestPath = resolve(repoRoot, input.manifestPath);
	assertInsideRepo(repoRoot, resultPath, "Proxy-cascade result path");
	assertInsideRepo(repoRoot, manifestPath, "Proxy-cascade manifest path");
	if (resultPath === manifestPath) throw new Error("Proxy-cascade result and manifest paths must be distinct");
	const bundleDirectory = dirname(resultPath);
	if (dirname(manifestPath) !== bundleDirectory) {
		throw new Error("Proxy-cascade result and manifest must be direct children of one exclusive bundle directory");
	}
	if (bundleDirectory === repoRoot)
		throw new Error("Proxy-cascade bundle directory must be below the repository root");
	return { repoRoot, bundleDirectory, resultPath, manifestPath };
}

async function writeClaimedFile(path: string, contents: string): Promise<void> {
	const handle = await open(path, "wx", 0o600);
	let complete = false;
	try {
		await handle.writeFile(contents, "utf8");
		await handle.sync();
		await handle.chmod(0o600);
		complete = true;
	} finally {
		await handle.close();
		if (!complete) await unlink(path).catch(() => undefined);
	}
}

export async function writeCompilerGymProxyCascadeBundleCreateOnly(
	input: CompilerGymProxyCascadeBundleWriteInput,
	hooks: CompilerGymProxyCascadeBundleWriteHooks = {},
): Promise<void> {
	await mkdir(dirname(input.bundleDirectory), { recursive: true, mode: 0o700 });
	await mkdir(input.bundleDirectory, { mode: 0o700 });
	let resultCreated = false;
	let manifestCreated = false;
	try {
		await hooks.beforeFileWrite?.(input.resultPath, 1);
		await writeClaimedFile(input.resultPath, input.resultContents);
		resultCreated = true;
		await hooks.beforeFileWrite?.(input.manifestPath, 2);
		await writeClaimedFile(input.manifestPath, input.manifestContents);
		manifestCreated = true;
	} catch (error) {
		if (manifestCreated) await unlink(input.manifestPath).catch(() => undefined);
		if (resultCreated) await unlink(input.resultPath).catch(() => undefined);
		await rmdir(input.bundleDirectory).catch(() => undefined);
		throw error;
	}
}

export async function checkCompilerGymProxyCascadeBundle(
	input: CompilerGymProxyCascadeBundleWriteInput,
): Promise<void> {
	const [resultContents, manifestContents] = await Promise.all([
		readFile(input.resultPath, "utf8"),
		readFile(input.manifestPath, "utf8"),
	]);
	if (resultContents !== input.resultContents) throw new Error("Proxy-cascade replay result is stale or drifted");
	if (manifestContents !== input.manifestContents)
		throw new Error("Proxy-cascade replay manifest is stale or drifted");
}
