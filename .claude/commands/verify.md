Run the full HexProcure quality gate in order and report each result explicitly with exit codes:

1. `npx tsc --noEmit`
2. `npm run lint`
3. `npx vitest run` (report pass/fail counts)
4. `npm run build`

Do not pipe commands through grep/filters that can mask exit codes.
If anything fails, fix it before claiming done. Finish with a one-line verdict:
PASS/FAIL per gate.
