---
"@booboo-brain/viewer": patch
---

`booboo:focus` now aims at what is SEEN, not at the canvas centre.

A focused node was centred in the full canvas while the dossier covered 420px of the
right of it, so it read visibly off-centre — and an embed that crops the viewer's chrome
away and runs its own copy column down one side wants the opposite correction. The viewer
cannot see any of that from the inside, so the message takes two new optional fields:

- `bias` — where the node should land, as a signed fraction of frame width from centre.
  Omitted, it defaults to half the dossier to the left, which is correct for the
  standalone viewer.
- `dist` — the framing distance in graph radii. "Point at this node" is not one framing
  for every host: a page whose claim is one-out-of-thousands needs the colony to stay
  whole; a board drilling into a subtree does not.

Both default to the tuned values, so existing hosts are unaffected. The default distance
moves 2.2 → 3 radii and the ease slows 0.055 → 0.032, tuned by shooting the frames rather
than reasoning about them: at 2.2r the field around the node is dim and the target is not
even distinguishable, and closer is worse still — 0.5r and 1.15r put the camera inside the
memory floor.
