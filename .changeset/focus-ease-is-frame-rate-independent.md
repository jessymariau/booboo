---
"@booboo-brain/viewer": patch
---

The focus camera now eases in real time rather than per rendered frame.

The marker it chases lives inside the drifting Spin group, so the target is never
stationary. A raw per-frame lerp closes the gap at whatever rate the client happens to
render at, which means a slow client trails a node that never stops moving and the frame
slides indefinitely instead of settling. Watched it fail exactly that way in a browser
running the scene at about 1fps: the node drifted past its mark and kept going.

The rate is now converted by delta time, so the move takes the same wall-clock time at
5fps as at 120fps. Delta is clamped, because a backgrounded tab hands back one enormous
frame on return and closing the whole distance in one step is a cut, not a move.

No change to where the camera ends up — the settled framing is byte-identical.
