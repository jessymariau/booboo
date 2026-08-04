---
"@booboo-brain/viewer": patch
---

Entrance backstop: a tab that stops rendering frames during the entrance (hidden, or occlusion-starved while its pixels stay on screen) used to strand the last composited frame mid-wave — links up, no field, no flags — with no in-app recovery. IntroDriver now settles by wall clock at 4.5s and forces one out-of-rAF frame, so the composited frame left behind is always the settled scene. The healthy entrance is untouched.
