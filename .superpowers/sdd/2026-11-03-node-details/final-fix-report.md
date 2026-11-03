# Node details final fix report

## Finding

Overlapping copies of different fields shared one request counter. Starting a
second field copy therefore suppressed the first field's eventual success or
failure feedback, even though its clipboard write had run.

## Change

`NodeDetailsDialog` now tracks request generations separately for content and
path. Close, unmount, and details replacement still invalidate both fields.
The new deferred-promise regression test starts both operations, resolves the
path successfully, and rejects content; it requires both matching messages and
rejects mismatched feedback.

## Evidence

- RED: `PATH=/home/zy/.nvm/versions/node/v22.23.4/bin:$PATH npm --prefix web run test -- tests/NodeDetailsDialog.test.tsx` failed the new assertion because “Path copied.” was missing; 10 other dialog tests passed.
- GREEN: the same focused command passed all 11 dialog tests, including the existing stale-on-close and details-replacement cases.
- TypeScript: `PATH=/home/zy/.nvm/versions/node/v22.23.4/bin:$PATH npm --prefix web run typecheck` exited 0.
- Distribution build: `PATH=/home/zy/.nvm/versions/node/v22.23.4/bin:$PATH make build` exited 0 and regenerated `dist`. Vite emitted its existing large-chunk warning.
- Distribution verification: `PATH=/home/zy/.nvm/versions/node/v22.23.4/bin:$PATH make verify-dist` passed after commit; the tracked rebuild matched `dist` and reported 5 manifested assets, 200 runtime package instances, and 110 license texts.
