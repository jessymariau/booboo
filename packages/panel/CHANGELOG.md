# @booboo-brain/panel

## 0.5.9

### Patch Changes

- 2e9cf7d: The review pass: state outranks finish, and absence is only honest when the
  read succeeded.

  - `.ag.staff`'s finish was silently stripping the selection ring, drag-over
    highlight and health wash from every staff plate (source-order at equal
    specificity); every state is restored explicitly and verified by simulating
    the state classes in both themes.
  - A failed health read now says so on the board instead of rendering an outage
    as a perfectly clean org; the dossier's stats and the reports count print a
    dash instead of a confident zero.
  - The GM's lit gradient is now visible in the light theme (it was a ≤7/255
    travel); `.ag-cadence` drops an opacity that broke AA by arithmetic; the
    reports register is ruled rather than carded at ledger width; the rule-bar
    scales against its declarer's own reach instead of the whole house; chips
    are honest toggle buttons (aria-pressed); the rules grid no longer overflows
    a phone; rank headers also settle on transitionend.

## 0.5.8

### Patch Changes

- Give the four ranks four finishes, and let the board use the window it is given.

  Measured on the live board at 1600×1000 before the change: 43.8% of the window
  unused on reports/rules/buckets (`max-width: 900px`), "No reports yet" rendered
  51 times on one screen, 62 plates sharing two distinct finishes, the rank
  column headers 154px off the columns they name at the DEFAULT zoom, and the
  reports filter unreachable by keyboard.

  - Rank reads through finish before a word: the law unfilled + dashed, the GM a
    lit gradient, a department a filled card lifting off its shelf, staff
    unfilled and flat, inset into it. Survives greyscale; never rests on hue.
  - Absence is quiet: a plate with no health, no report and no declared beat
    draws no fact row at all.
  - The rank headers are measured off the same `data-rail` anchors the elbows
    use, followed frame-by-frame through the chart's transform transition —
    drift is now 0–1px at every zoom.
  - A failed fetch is no longer an answer of zero: loaded, loading and failed
    are three states, and failed prints a dash and says what it does not know.
  - Clickable chips are `<button>`s (the reports filter was `<span>`s — no tab
    stop, no Enter, invisible to a screen reader), the reports list can reach
    past its first 100 entries, the rules list grids instead of stacking, and
    the dossier reflows to a bottom sheet at 1080px rather than 760.

  Verified in both themes with a contrast probe that samples every text-bearing
  element at any size and was poisoned first to prove it can fail: zero
  failures, zero console errors, no horizontal overflow at 1600/1000/900.

## 0.5.7

### Patch Changes

- 2ed5ff1: Point `mcpName` and every package's repo metadata at the current GitHub identity
  (`jessymariau`).

  Jesse's GitHub account was renamed from `jessedu29260-netizen` on 2026-07-26. The MCP
  registry does not migrate namespaces: `io.github.*` publish rights are granted against
  the _current_ GitHub login, so the published entries under
  `io.github.jessedu29260-netizen/booboo` can no longer be edited by their author, and the
  canonical server identity has to move. Republishing requires a new npm version, because
  the registry validates `mcpName` against the **exact** package version named in
  `server.json` and npm versions are immutable — 0.5.1 will forever carry the old name.

  Every package is bumped, not just the CLI, because all eight carry `repository`,
  `homepage` and `bugs` pointing at the old handle. GitHub 301-redirects those today, but
  the redirect breaks the moment anyone claims the abandoned username and creates a repo
  called `booboo` — at which point eight npm package pages would link a stranger's repo as
  Booboo's source.

  Metadata only. No `bin`, `dist/` or runtime path is touched, so `npx @booboo-brain/cli`
  keeps working for existing users at every version.

- 6701e3b: Make both faces work below desktop width — the first time either has been looked at on a phone.

  **viewer** — the camera now fits to aspect. `fov` in three.js is the _vertical_
  angle, so the horizontal one is whatever the viewport leaves you: a comfortable
  ~37° at 1600×1000, and ~11° at 390×844, which put the camera inside the building
  looking at three light-shafts edge-on. It dollies back instead of widening the
  lens, because holding the horizontal angle costs a 73° vertical fov on a phone
  and that much distortion turns a measured orrery into a fisheye. Desktop framing
  is unchanged (the factor is exactly 1 at the aspect the scene was composed at),
  and a resize only re-frames when the fit actually changes, so it can no longer
  throw away a user's zoom and pan.

  Also on narrow: the orientation card docks to the bottom instead of covering the
  top third of the scene it is explaining, the 3D band labels are dropped (pulled
  back far enough to fit a phone they overprint into a smear, and the card already
  names the bands in order), the fourteen-slider drawer is hidden (its button sat
  on top of the hint line), and the band legend is dropped as a second copy of what
  the card already says. Touch devices are told "drag to turn · pinch to zoom · tap
  a node" rather than to scroll and press a key they do not have.

  **panel** — the auto-fit is floored at 45%. The arithmetic that gives a laptop a
  readable 70% gives a phone 20%, where a plate is a coloured rectangle with a grey
  smudge for a name; below the floor it stops shrinking and the board scrolls. And
  the root is no longer auto-selected on a narrow viewport — there the dossier is
  not a right rail but a sheet over half the screen, so a visitor's first sight of
  the staff board was a card about one agent covering it. This is the same argument
  the `?embed=1` case already made, applied one breakpoint further down.

- Updated dependencies [2ed5ff1]
  - @booboo-brain/spec@0.3.2
