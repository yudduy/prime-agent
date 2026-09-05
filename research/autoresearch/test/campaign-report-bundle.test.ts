import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";
import { verifyCampaignReportBundle, writeCampaignReportBundle } from "../src/campaign-report-bundle.js";

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("regenerates a deterministic complete report bundle and rejects stale evidence or HTML", async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), "prime-campaign-report-test-"));
	tempDirectories.push(repoRoot);
	const reportDir = join(repoRoot, "reports");
	await mkdir(reportDir);
	await writeFile(join(repoRoot, "evidence.json"), '{"result":"negative"}\n', "utf8");
	await writeFile(
		join(reportDir, "campaign-v1.md"),
		"# Campaign\n\n[Evidence](../evidence.json)\n\n[Manifest](campaign-v1.sha256)\n",
		"utf8",
	);
	await writeFile(join(reportDir, "source-evidence-v1.md"), "# Source evidence\n\nNo external claim.\n", "utf8");
	await writeFile(join(reportDir, "report.css"), "body { color: #111; }\n", "utf8");

	const options = { repoRoot, reportDir };
	const first = await writeCampaignReportBundle(options);
	assert.equal(first.manifestEntries, 6);
	await verifyCampaignReportBundle(options);
	const firstManifest = await readFile(first.manifestPath, "utf8");
	const firstCampaignHtml = await readFile(join(reportDir, "campaign-v1.html"));
	assert.match(firstManifest, / {2}\.\.\/evidence\.json$/m);
	assert.doesNotMatch(firstManifest, /campaign-v1\.sha256/);

	const second = await writeCampaignReportBundle(options);
	assert.equal(await readFile(second.manifestPath, "utf8"), firstManifest);
	assert.deepEqual(await readFile(join(reportDir, "campaign-v1.html")), firstCampaignHtml);

	await writeFile(join(repoRoot, "evidence.json"), '{"result":"positive"}\n', "utf8");
	await assert.rejects(verifyCampaignReportBundle(options), /does not match the complete report bundle/);

	await writeCampaignReportBundle(options);
	await writeFile(join(reportDir, "campaign-v1.html"), "stale\n", "utf8");
	await assert.rejects(verifyCampaignReportBundle(options), /is stale relative to campaign-v1\.md/);
});
