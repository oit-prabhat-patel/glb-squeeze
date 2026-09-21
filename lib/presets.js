// Per-role output budgets.
//
// The whole point of a preset is a CONSISTENT, absolute target. `squeeze.sh`'s
// RATIO knob keeps a *fraction* of each model — so a 2M-tri and a 120k-tri input
// come out wildly different (300k vs 18k). A preset instead names the budget the
// role can afford on screen, and squeeze() computes whatever per-file ratio hits
// it. Drop a pile of models of mixed provenance in, and everything of one role
// lands at the same weight.
//
//   targetTris  the triangle budget for the role (the simplify aims for this)
//   texSize     max texture dimension in px (biggest VRAM lever — see README)
//   error       simplify error tolerance, as a fraction of the model's size.
//               It is a QUALITY FLOOR: the simplifier will stop above targetTris
//               rather than cross this, so a detail-critical model keeps what it
//               needs. Low = protect the silhouette; high = cut freely.
//
// Sizes are picked for how big the role is actually seen. Tune per project.

export const PRESETS = {
  hero: {
    targetTris: 80000, texSize: 2048, error: 0.001,
    blurb: 'The main subject — a deity, a character. Seen large, close, and studied.',
  },
  prop: {
    targetTris: 12000, texSize: 1024, error: 0.01,
    blurb: 'Objects dressing the scene — lamps, bowls, tools. Seen at medium size.',
  },
  decor: {
    targetTris: 6000, texSize: 1024, error: 0.02,
    blurb: 'Background / large low-detail pieces — a pedestal, a backdrop, foliage.',
  },
  particle: {
    targetTris: 2000, texSize: 256, error: 0.03,
    blurb: 'Tiny things shown in bulk — petals, embers, confetti. Detail is invisible.',
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);
export const DEFAULT_PRESET = 'prop';

export function resolvePreset(name) {
  return PRESETS[name] ? name : DEFAULT_PRESET;
}
