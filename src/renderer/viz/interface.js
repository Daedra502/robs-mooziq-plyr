// =============================================================================
// Visualizer interface
// =============================================================================
//
// A visualizer is any object implementing the methods below. The VizManager owns
// the render loop, input capture, and the canvas; it feeds each visualizer a
// `frame` object every animation frame. The audio engine does NOT know this
// interface exists — data flows engine -> manager -> visualizer.
//
// Adding a new visualizer = create one module exporting a class that implements
// this shape, then register it in app.js. Nothing else needs to change.
//
//   init(canvas, context)
//     canvas  : the shared HTMLCanvasElement to draw into.
//     context : shared, long-lived refs:
//                 { audioContext, analyser, leftAnalyser, rightAnalyser,
//                   seek(fraction0to1), getPlayback() }
//               Note `seek`/`getPlayback` let input-driven visualizers (e.g. the
//               waveform's click-to-seek) talk back to playback without the
//               engine depending on them.
//
//   update(frame)
//     Called once per animation frame while this visualizer is active. `frame`:
//       {
//         freq    : Uint8Array  // FFT magnitudes (0..255)
//         time    : Uint8Array  // mono time-domain (0..255, 128 = silence)
//         left    : Uint8Array  // left-channel time-domain
//         right   : Uint8Array  // right-channel time-domain
//         input   : {
//           pointer : { x, y, nx, ny, down }  // x/y in canvas pixels, nx/ny 0..1
//           keys    : Set<string>             // currently-held key codes
//           drag    : boolean                 // pointer moved while down
//         }
//         timing  : { elapsed, delta }        // ms since start / since last frame
//         playback: { currentTime, duration, playing }
//       }
//     The `input` and `timing` fields are always present, so a future
//     mouse-driven particle system is a drop-in: it just reads frame.input.
//
//   resize(w, h)   // canvas backing-store size changed (device pixels)
//   destroy()      // release any resources; called on teardown
//
// A convenience base class is provided; extending it is optional.

export class Visualizer {
  init(canvas, context) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.context = context;
    this.w = canvas.width;
    this.h = canvas.height;
  }
  update(_frame) {}
  resize(w, h) {
    this.w = w;
    this.h = h;
  }
  destroy() {}
}
