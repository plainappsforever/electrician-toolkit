# Engine fixtures E1–E8 (SPEC §8, acceptance A1)

Every expected number is copied **verbatim from SPEC §8** — never computed by the engine and never edited to make a test
pass (D23, CLAUDE.md). `src/engine/fixtures.test.ts` runs each case through `compute(kind, input)`.

Expected entries (`path` → expectation):
- `values.<name>`: a plain number = exact in the SPEC → relative tolerance 1e−9; `{ "printed": "3.7565217391" }` = the
  SPEC prints a rounded value → passes when |engine − printed| ≤ max(1e−9·|printed|, ½ unit of the last printed digit).
- `texts.<name>`: exact string (e.g. `"verdict": "exceeds"`, `"suggestion": "B13"`).
- `checks.<id>`: the check's `met` flag (e.g. `checks.coord.c2: false`).
- `warnings`: these warning codes must be present.

Inputs the SPEC leaves open are stated in the case name (e.g. "limit not in SPEC: 3 %" — the limit changes no value
asserted there).
