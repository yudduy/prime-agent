import argparse
import hashlib
import json
from decimal import Decimal
from fractions import Fraction
from pathlib import Path
from time import perf_counter

directory = Path(__file__).resolve().parent
source_path = directory.parent / "source.json"
parser = argparse.ArgumentParser(description="Prepare and exactly verify the frozen minimum-overlap baseline.")
parser.add_argument("--output", type=Path, required=True)
options = parser.parse_args()
raw = source_path.read_bytes()
if hashlib.sha256(raw).hexdigest() != "33422e43982bb38969e63e3758296f9d9f14e2512447da86d0fcee411eb4a90b":
    raise ValueError("Frozen public source changed")
source = json.loads(raw, parse_float=Decimal)[0]
decimals = [Decimal(value) for value in source["data"]["values"]]
places = max(0, max(-value.as_tuple().exponent for value in decimals))
denominator = 10**places
values = [int(Fraction(value) * denominator) for value in decimals]
n = len(values)
assert 2 <= n <= 4096 and places <= 60
assert all(0 <= value <= denominator for value in values)
assert n * denominator % 2 == 0
mass_before = sum(values)
target = n * denominator // 2
excess = mass_before - target
changed_index = max(range(n), key=values.__getitem__) if excess >= 0 else min(range(n), key=values.__getitem__)
before = values[changed_index]
values[changed_index] -= excess
assert all(0 <= value <= denominator for value in values)
assert sum(values) == target

def decimal_string(integer):
    if places == 0:
        return str(integer)
    text = str(integer).rjust(places + 1, "0")
    return f"{text[:-places]}.{text[-places:]}"

started = perf_counter()
complements = [denominator - value for value in values]
maximum, max_shift = -1, None
for shift in range(1 - n, n):
    overlap = sum(values[index] * complements[index + shift] for index in range(max(0, -shift), min(n, n - shift)))
    if overlap > maximum:
        maximum, max_shift = overlap, shift
score = Fraction(2 * maximum, n * denominator * denominator)
elapsed = perf_counter() - started
check = {
    "valid": True,
    "score": float(score),
    "scoreNumerator": str(score.numerator),
    "scoreDenominator": str(score.denominator),
    "maxShift": max_shift,
    "bins": n,
}
result = {
    "values": list(map(decimal_string, values)),
    "source": {
        "url": "https://einsteinarena.com/api/solutions/best?problem_id=1&agent_name=CodexProLong&limit=1",
        "frozenFile": "source.json",
        "sha256": hashlib.sha256(raw).hexdigest(),
        "submissionId": source["id"],
        "agentName": source["agentName"],
        "createdAt": source["createdAt"],
        "reportedScore": str(source["score"]),
    },
    "correction": {
        "policy": "Subtract exact excess mass from the largest bin, or add exact missing mass to the smallest bin.",
        "index": changed_index,
        "before": decimal_string(before),
        "after": decimal_string(values[changed_index]),
        "massDefectBefore": str(Fraction(excess, denominator)),
        "massDefectAfter": "0",
        "absoluteChange": str(Fraction(abs(excess), denominator)),
        "conservativeScoreChangeBound": str(Fraction(4 * abs(excess), n * denominator)),
    },
    "check": check,
    "independentVerification": {
        "arithmetic": "Python integers; exact rational reduction with fractions.Fraction",
        "signedShiftsChecked": 2 * n - 1,
        "pairProducts": n * n,
        "elapsedSeconds": elapsed,
    },
}
with options.output.open("x") as stream:
    json.dump(result, stream, indent=2)
    stream.write("\n")
print(json.dumps({"check": check, "correction": result["correction"], "elapsedSeconds": elapsed}))
