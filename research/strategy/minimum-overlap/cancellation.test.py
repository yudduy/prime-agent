import argparse
import json
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description="Check submission cancellation using the faux provider and real containers.")
parser.add_argument("--image", required=True)
parser.add_argument("--seed-file", type=Path, required=True)
parser.add_argument("--output-dir", type=Path, required=True)
options = parser.parse_args()
root = Path(__file__).resolve().parent
repo = root.parents[2]
source = (root / "run.mts").read_text()
assert source.count("requireActiveAllocation();") == 2
assert source.count("const check = checkConstruction(candidateValues);") == 1
options.output_dir.mkdir(parents=True, exist_ok=True)
output_root = Path(tempfile.mkdtemp(prefix="cancellation-", dir=options.output_dir))
results = []
for case in ["cancel_after_copy", "deadline_before_check"]:
    for fixed in [False, True]:
        variant = source if fixed else source.replace("requireActiveAllocation();", "")
        if case == "cancel_after_copy":
            variant = variant.replace("const check = checkConstruction(candidateValues);", "workAbort.abort(); const check = checkConstruction(candidateValues);")
        else:
            variant = variant.replace("const started = Date.now();", "let started = Date.now();")
            variant = variant.replace("const check = checkConstruction(candidateValues);", "started = 0; const check = checkConstruction(candidateValues);")
        with tempfile.NamedTemporaryFile(mode="w", prefix="fixture-", suffix=".mts", dir=root, delete=False) as stream:
            stream.write(variant)
            path = Path(stream.name)
        try:
            process = subprocess.run([
                str(repo / "node_modules/.bin/tsx"), "--tsconfig", str(repo / "tsconfig.json"), str(path),
                "--seed-file", str(options.seed_file.resolve()), "--image", options.image,
                "--output-dir", str(output_root), "--dry-run",
            ], capture_output=True, text=True, timeout=55)
            first = next(line for line in process.stdout.splitlines() if line.startswith("Saved experiment: "))
            output = Path(first.removeprefix("Saved experiment: "))
            receipts = list(output.glob("*-pair-*/submissions.jsonl"))
            accepted = sum(len(p.read_text().splitlines()) for p in receipts)
            assert (accepted == 0) == fixed, (case, fixed, accepted, process.stdout, process.stderr)
            results.append({"case": case, "fixed": fixed, "accepted": accepted, "exitCode": process.returncode, "outputDir": str(output)})
        finally:
            path.unlink()
(output_root / "result.json").write_text(json.dumps({"passed": True, "cases": results}, indent=2)+"\n")
print(json.dumps({"passed": True, "cases": results}))
