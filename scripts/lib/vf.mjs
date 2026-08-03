// The ffmpeg filter chain shared by record.mjs and film.mjs. Both of them need
// the same two things — a portrait crop and a seamless loop — and two copies of
// one mechanism is this project's most repeated defect (GAPS C29, C33, C2), so
// it lives here and gets imported.
//
// PING-PONG is forced rather than chosen. The scene's turn rate is a sum of
// incommensurate sines (`Spin` in Booboo.tsx: 0.065 + .085·sin(.047t) +
// .05·sin(.019t) + .025·sin(.101t)), so it never returns to its start — there is
// no revolution to cut on. Forward then reversed is seamless by construction,
// and at ~0.07 rad/s no viewer can tell which direction is "real". The reverse
// leg drops the first and last frame so neither seam repeats a frame and
// stutters.
//
// CROP exists because the scene is composed for a 1.6 aspect and AspectFit holds
// the horizontal angle by dollying BACK — so a portrait record pushes the camera
// out to k=2.84 and the house arrives as a speck in a black field. That is what
// FIT_MAX's own comment predicts, and what it says to do instead: crop. Record
// wide, crop portrait, and no pixel is resampled.
export const pingpong = (n) =>
  `split[a][b];[b]reverse,trim=start_frame=1:end_frame=${n - 1},setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1:a=0`;

// `crop` is an ffmpeg crop spec (w:h:x:y) or falsy; `loopFrames` is the captured
// frame count to ping-pong over, or falsy to keep the arc as recorded. Pass the
// result to -filter_complex: the looping form carries stream labels, and ffmpeg
// accepts a plain chain there too, so one flag covers both.
export const chain = ({ crop, loopFrames } = {}) =>
  [crop && `crop=${crop}`, "format=yuv420p", loopFrames && pingpong(loopFrames)]
    .filter(Boolean)
    .join(",");
