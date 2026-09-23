// Per-role output budgets + the simplification METHOD each role should use, plus
// a global QUALITY preference that scales the budget up or down.
//
// Why presets: a preset names an ABSOLUTE on-screen budget, not a fixed fraction
// of whatever a model happened to start as — so a folder of mixed-provenance
// models (a 2M-tri hero next to a 300k-tri prop) comes out consistent instead of
// wildly uneven. squeeze() reads each input's triangle count and derives the
// per-file reduction needed to hit the role's target.
//
// Why a method per role — the one hard-won lesson of this tool. Asset-generator
// meshes are thousands of DISCONNECTED islands, and the three simplifiers behave
// completely differently on them:
//   • standard  — topology-preserving. Best quality, protects the silhouette and
//                 UVs, but can't collapse across island seams so it FLOORS far
//                 above target (a 2M-tri hero stops ~120k). Right for a HERO.
//   • sloppy    — topology-ignoring. Reaches any target, but on a THIN sheet or
//                 thin sticks it fuses front-to-back into gravel. Only safe on
//                 chunky/volumetric bulk where you want maximum reduction.
//   • snapweld  — quantize positions onto a grid so seam vertices weld, then
//                 topology-preserving simplify along the reconnected surface.
//                 Reaches aggressive targets WITHOUT gravelling thin geometry;
//                 the cost is faint position terracing (invisible when small or
//                 in bulk, visible on a big smooth face — so never for a hero).
//                 The safe default for everything that isn't the hero.
//
//   method      'standard' | 'sloppy' | 'snapweld'  (see above)
//   targetTris  triangle budget the role can afford on screen
//   texSize     max texture dimension in px (the real VRAM lever — see README)
//   error       simplify error tolerance. For 'standard' it's a QUALITY FLOOR
//               (low = protect the silhouette; the sim stops above target rather
//               than cross it). For 'snapweld' it's how hard the post-weld
//               simplify pushes (higher = reach the target on stubborn meshes).
//
// Tune per project. These defaults are the "balanced" recommendation validated on
// the ePooja scene (deity murti + diyas + aarti + incense + petal shower).

export const PRESETS = {
  hero: {
    method: 'standard', targetTris: 120000, texSize: 2048, error: 0.004,
    blurb: 'The main subject — a deity, a character. Seen large, close, studied. Topology-preserving so the face never smears.',
  },
  prop: {
    method: 'snapweld', targetTris: 60000, texSize: 1024, error: 0.5,
    blurb: 'Objects dressing the scene — lamps, bowls, incense, tools. Snap-weld keeps thin parts (sticks, spoons) from gravelling.',
  },
  decor: {
    method: 'snapweld', targetTris: 20000, texSize: 1024, error: 0.6,
    blurb: 'Backdrops, pedestals, large low-detail pieces. Reduced hard; seen big but rarely studied up close.',
  },
  particle: {
    method: 'snapweld', targetTris: 8000, texSize: 384, error: 0.9,
    blurb: 'Tiny things shown in bulk — petals, embers, confetti. Decimated far; nobody reads one mid-fall.',
  },
};

// Global quality preference — scales a role's triangle budget and texture size.
// 'balanced' is the recommended default (the validated numbers above).
export const QUALITY = {
  high:     { label: 'High quality',          tris: 2.0, tex: 2,   note: 'more triangles + larger textures — closer to source' },
  balanced: { label: 'Balanced (recommended)', tris: 1.0, tex: 1,   note: 'the tuned default: light and clean' },
  small:    { label: 'Smaller',               tris: 0.5, tex: 0.5, note: 'smallest download/VRAM — accept a little more loss' },
};

export const PRESET_NAMES = Object.keys(PRESETS);
export const QUALITY_NAMES = Object.keys(QUALITY);
export const DEFAULT_PRESET = 'prop';
export const DEFAULT_QUALITY = 'balanced';

const clampTex = (px) => Math.max(128, Math.min(2048, Math.round(px)));

export function resolvePreset(name) { return PRESETS[name] ? name : DEFAULT_PRESET; }
export function resolveQuality(q) { return QUALITY[q] ? q : DEFAULT_QUALITY; }

// The effective preset after applying a quality preference: what squeeze() acts on.
export function effectivePreset(name, quality) {
  const pn = resolvePreset(name), qn = resolveQuality(quality);
  const p = PRESETS[pn], t = QUALITY[qn];
  return {
    name: pn, quality: qn, method: p.method, error: p.error, blurb: p.blurb,
    targetTris: Math.round(p.targetTris * t.tris),
    texSize: clampTex(p.texSize * t.tex),
  };
}
