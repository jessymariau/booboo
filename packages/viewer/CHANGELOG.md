# @booboo-brain/viewer

## 0.2.0

### Minor Changes

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

- Updated dependencies [2ed5ff1]
  - @booboo-brain/spec@0.3.2
