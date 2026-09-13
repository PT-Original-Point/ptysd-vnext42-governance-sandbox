from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src" / "message.txt"
actual = p.read_text(encoding="utf-8")
expected = "HELLO_FROM_OPENCODE\n"
if actual != expected:
    raise SystemExit(f"FAIL expected={expected!r} actual={actual!r}")
print("PASS_Z5_SYNTHETIC_MESSAGE")
