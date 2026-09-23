# glb-squeeze

Batch-compress GLB/glTF models for mobile and web delivery. A thin, opinionated
wrapper around [glTF-Transform](https://gltf-transform.dev/) that turns a folder
of 60 MB "download from an asset generator" models into ~1.4 MB files you can
actually ship over a mobile connection.

Typical result on generated (photogrammetry/AI) murti and prop models — a raw
~2 M-triangle, ~60 MB export comes down to a small, consistent file per role:

```
particle (petal)   2.0 M tris, 60 MB  →   ~8 k tris,  ~90 KB   (balanced)
prop (incense)      2.0 M tris, 58 MB  →  ~24 k tris, ~330 KB   (balanced)
hero (deity murti)  1.9 M tris, 61 MB  →  ~120 k tris, ~0.9 MB  (balanced)
```

Roughly **50–700× smaller** depending on role, and — because presets target an
absolute budget, not a fixed ratio — every model of one role lands at the same
weight no matter what it started at. `--quality small` goes smaller still.

## Quick start

```bash
npm install
```

**Interactive** — drop models in the browser, preview before/after, download:
double-click **`run-ui.command`** (macOS), or run `npm run ui` → http://localhost:4747

**Batch** a whole folder by role:

```bash
npm run squeeze:prop -- ~/models ~/models-out
```

Originals are never modified — outputs keep their filenames in the target folder.

## Role presets — one consistent output per role

The core idea, and the reason presets exist: a preset names an **absolute budget**
for how a model is *used on screen*, not a fixed fraction of whatever it happened
to start as. A raw ratio ("keep 15%") turns a 2 M-tri and a 300 k-tri input into
wildly different outputs; a preset makes a folder of mixed-provenance models come
out **consistent** — everything of one role lands at the same weight. Each preset
also picks the **right simplifier for that role** (see below).

| Preset | Method | Target | Textures | For |
|---|---|---|---|---|
| `hero` | standard | ≤ 120,000 tris | 2048 px | the main subject — deity, character; seen large & close |
| `prop` | snap-weld | ≤ 60,000 tris | 1024 px | scene objects — lamps, bowls, incense, tools; medium size |
| `decor` | snap-weld | ≤ 20,000 tris | 1024 px | backdrops, pedestals, large low-detail pieces |
| `particle` | snap-weld | ≤ 8,000 tris | 384 px | tiny things in bulk — petals, embers, confetti |

These are the **balanced (recommended)** budgets, validated on a real scene
(deity murti + diyas + aarti + incense + a 40-instance petal shower: ~12 M
tris/frame → ~700 k). Pick a lighter or heavier point with `--quality` (below).

### Three simplifiers, chosen per role — the one hard-won lesson

Asset-generator and scan meshes are **thousands of disconnected islands** (surface
patches whose seams don't share vertices). That single fact makes the three
simplifiers behave completely differently, and picking the wrong one is what
"destroys" a model:

- **standard** (meshopt, topology-preserving) — protects the silhouette, UVs and
  the face; best quality. But it can't collapse across island seams, so it
  **floors far above target** (a 2 M-tri hero stops ~120 k). Right for a **hero**:
  the floor *is* the quality guarantee.
- **sloppy** (meshopt, topology-ignoring) — reaches any target, but on a **thin
  sheet** (a petal) or thin sticks (incense) it fuses the front and back surfaces
  into gravel — total destruction — at *every* target. Only safe on chunky,
  volumetric bulk. (Kept as a `method` you can set in a preset; no preset uses it
  by default.)
- **snap-weld** (this tool's fix, the default for everything that isn't a hero) —
  quantize positions onto a grid so seam vertices weld, reconnecting the islands,
  *then* run the topology-preserving simplifier along the joined surface. Reaches
  aggressive targets **without gravelling thin geometry**. The cost is faint
  position *terracing* that grows with the grid — invisible when small or in bulk,
  visible on a big smooth face (so never for a hero). It auto-escalates the grid
  until the target is in reach; see [`lib/snapweld.js`](lib/snapweld.js).

Set the method + budget per role in [`lib/presets.js`](lib/presets.js).

### Quality preference

A global preference scales every role's triangle budget and texture size, so you
can trade size for fidelity without touching the presets:

| `--quality` | Triangles | Textures | When |
|---|---|---|---|
| `high` | 2× the budget | 2× (capped 2048) | closest to source; keep more |
| `balanced` *(default, recommended)* | the tuned budget | as listed | light and clean |
| `small` | ½ the budget | ½ | smallest download / VRAM; accept a little more loss |

```bash
npm run squeeze:hero     -- ./in ./out
npm run squeeze:prop     -- ./in ./out
npm run squeeze:decor    -- ./in ./out
npm run squeeze:particle -- ./in ./out

# with a quality preference, or the CLI directly with parallelism:
node squeeze-cli.js ./in ./out --preset prop --quality balanced --jobs 8
node squeeze-cli.js ./in ./out --preset particle --quality small
```

## Web UI

**Easiest — double-click [`run-ui.command`](run-ui.command)** (macOS): it installs
dependencies on first run, starts the server, and opens the app in your browser.
Keep the window open while you use it; close it (or Ctrl-C) to stop.

Or from a terminal (any OS):

```bash
npm run ui          # → http://localhost:4747
```

A localhost app (bound to `127.0.0.1` only). **Drop one or many `.glb` files**,
pick a **role** (each card shows the method + budget it will use) and a **quality
preference** (High / Balanced-recommended / Smaller), and each is squeezed on the
spot against the same pipeline as the CLI. A results table shows before → after
triangles and size; **Preview** opens a locked-camera *original vs squeezed* 3D
compare (live version of `compare.html`), and **Download** saves the optimized
file. It runs the CLI on whatever you POST, so never expose it beyond localhost.

Use the UI to eyeball and spot-squeeze; use the CLI presets for bulk folders.

## Raw ratio control (advanced)

The original bash tool is still here for when you want an exact ratio rather than
a target budget:

```bash
npm run squeeze:raw -- ./in ./out          # or ./squeeze.sh ./in ./out
```

It writes a `_squeeze/` folder of per-file logs + a `squeeze-report.csv`, and all
its knobs are environment variables:

| Var | Default | What it does |
|---|---|---|
| `RATIO` | `0.15` | Fraction of vertices to keep. The single biggest lever. |
| `ERROR` | `0.001` | Simplification error tolerance, as a fraction of mesh extent. |
| `TEX_SIZE` | `2048` | Max texture dimension in px. |
| `TEX_FORMAT` | `webp` | `webp`, `avif`, `ktx2`, or `auto`. See the VRAM note below. |
| `COMPRESS` | `draco` | `draco`, `meshopt`, or `quantize`. |
| `JOBS` | `4` | Files processed in parallel. |

```bash
RATIO=0.35 TEX_SIZE=4096 npm run squeeze:raw -- ./in ./out   # keep more geometry
```

### Particles: go further than you think

A single **rose petal** exported from an asset generator came in at
**299,124 triangles** — invisible detail for something that falls past the
screen ~40 px tall. Worse, it was rendered as an *instanced shower* (one mesh,
dozens of copies), so that triangle count multiplied: 40 petals ≈ 12 M
tris/frame, which dragged a mid-range phone to **6 fps**.

`npm run squeeze:particle` takes the raw petal (**~2 M triangles, 60 MB**) down to
**~8 k tris + 384px textures + draco (≈ 90 KB)** — and every other flower in the
folder to the same budget — so the shower runs smooth. For a tumbling particle you
can decimate far past what you'd dare on a hero mesh; nobody reads a petal's
silhouette mid-fall.

But **not with the sloppy simplifier** — a petal is a thin sheet, and sloppy fuses
its two surfaces into gravel at *every* target (we tried 18 k, 7 k, 2 k — all
rubble). The topology-preserving simplifier keeps it smooth but floors at ~287 k
(disconnected islands). `particle` therefore uses **snap-weld** (see the
three-simplifiers note above): it reconnects the islands so the petal stays a clean
curved petal down to ~8 k. Faint terracing appears at aggressive grids but is
invisible on something 40 px tall and falling. Push it further with
`--quality small` (~4–5 k + 192px).

Two consumer-side notes once the file is tiny — both are about the *shower*, not
the compression:

- Draw the whole shower as **one `InstancedMesh`**, not N cloned meshes — a
  single draw call instead of dozens.
- **Force the material opaque** (`material.transparent = false`, no `alphaTest`).
  These GLBs often ship flagged transparent; N transparent, double-sided
  instances blending over each other is its own fps cliff, separate from the
  triangle count.

## Checking your work

`compare.html` renders the original and compressed model side by side with
**locked cameras**, so you're comparing meshes rather than viewing angles. Each
pane reports its file size and triangle count.

```bash
python3 -m http.server 8080
# → http://localhost:8080/compare.html?a=orig/model.glb&b=out/model.glb
```

Drag to orbit; both panes move together. Always eyeball a hero asset before
committing to a ratio — decimation artifacts show up on silhouettes and
thin features (flame tips, jewellery, petal edges) long before they show up
on flat surfaces.

## Rendering a looping sway animation

`render/sway.js` turns a model into a seamlessly looping animated WebP — the
murti rotating gently left and right — sized for a UI card.

```bash
node render/sway.js model.glb out.webp --amp 14 --anchorX 0.72
```

| Flag | Default | What it does |
|---|---|---|
| `--frames` / `--fps` | `30` / `15` | Sampling / playback rate. 30 @ 15 = a 2s loop. |
| `--amp` | `14` | Sway half-angle in degrees. |
| `--yaw` | `0` | Base facing correction in degrees, applied before the sway. |
| `--anchorX` / `--anchorY` | `0.72` / `0.46` | Where the subject sits in frame (0–1). |
| `--fill` | `0.78` | Max subject height as a fraction of canvas height. |
| `--fillW` | `0.52` | Max subject width as a fraction of canvas width. |
| `--glowR` / `--glowA` | `0.78` / `0.73` | Backdrop halo radius and opacity. |
| `--w` / `--h` | `720` / `432` | Output size. |
| `--q` | `72` | WebP quality. |

Unknown flags, non-numeric values and odd argument counts are rejected rather
than ignored. If you pass flags via a shell variable, **quote it** — zsh does
not word-split unquoted expansions, so `$FLAGS` arrives as a single argument.

The sway is `sin(2π·phase)`, so the last frame meets the first exactly and the
loop has no visible seam. A `-still.png` is written next to the output — the
**neutral** frame, not a mid-sway one, since a sine spends its extremes turned
and a peak frame makes a correctly-centred subject look crooked.

Frame count and playback rate are independent levers worth understanding:
`--frames` sets how finely one sine period is sampled and therefore the file
size; `--fps` only sets how fast those frames play. **Halving the speed is
free** — drop `--fps`. Adding frames is what costs bytes, and you only need
them if the slower playback starts to judder.

### Finding each model's facing

Exported GLBs face arbitrary directions, so `--yaw` squares a model up before
the sway is applied. `contact.js` renders every model at eight facings — one
strip per model, loading each model once rather than relaunching per angle:

```bash
node render/contact.js ./facings model-a.glb model-b.glb
```

Pick the front-on column by eye, then put that angle in the batch config.

### Batch rendering

```bash
node render/batch.js render/deities.json ./out              # full render
node render/batch.js render/deities.json ./out --frames 2   # fast framing preview
node render/batch.js render/deities.json ./out --modelDir ~/models
```

The config carries defaults plus per-model overrides. Those overrides are not
optional polish — subjects in one set can range from a narrow standing figure
to a chariot-and-horses to a squat shrine, and a single `fill` either crops the
tall ones through the body or renders the wide ones tiny. The `--frames 2`
preview exists to catch exactly that before paying for full renders.

Framing fits inside **both** `--fill` (max height) and `--fillW` (max width),
whichever binds, measured *after* the yaw correction — so a wide subject shrinks
to stay clear of the card's text instead of sprawling across it.

**Why WebP rather than GIF:** GIF caps at 256 colors, which bands badly across
the gold and skin gradients on a rendered murti, and it can't do partial-frame
updates well. Animated WebP keeps 24-bit color and re-encodes only the
rectangle that actually changed — with a static backdrop and a moving subject,
that means the background is stored once and each frame costs ~16 KB instead of
a full re-encode. A 2s loop at 720×432 lands around 450 KB.

Requires `img2webp` (`brew install webp`).

## Why this works

The instinct carried over from images — "compress the textures" — is usually
wrong for generated GLBs. A representative 61 MB model breaks down as:

| Component | Size |
|---|---|
| Mesh geometry | **57.08 MB** |
| All three 4K textures (JPEG) | 3.9 MB |

Geometry is **94%** of the file. Those models carry ~2 million triangles, which
is absurd for something rendered a few hundred pixels tall on a phone. So the
order that matters is:

1. **Simplify** — decimate the mesh. Biggest win by far, and the only one with
   a visual cost worth reviewing.
2. **Compress geometry** — Draco typically gets 6–7x on vertex data alone, and
   is lossless-ish once the mesh is quantized.
3. **Then** worry about textures.

Running only steps 2–3 on that same model gave 9.18 MB. Adding step 1 took it
to 2.19 MB.

## Two things worth knowing

**WebP does not reduce VRAM.** Those 4096×4096 textures cost ~89 MB of GPU
memory *each* — 268 MB for a three-texture material — no matter how small the
file is on disk. JPEG, WebP and AVIF all decompress to raw RGBA on the GPU. The
only two fixes are shrinking the texture (`TEX_SIZE`, what the default does) or
`TEX_FORMAT=ktx2`, which stays compressed in VRAM. If you're chasing OOM crashes
on low-end Android rather than download size, reach for `ktx2`.

**Draco costs CPU at load.** Decoding ~1M vertices runs roughly 1–2s on a
mid-range phone. `COMPRESS=meshopt` decodes far faster but compresses less
(4.2x vs 6.6x in testing). If you simplify aggressively first, the mesh is small
enough that this stops mattering.

## Requirements

Node 18+. Everything else installs via `npm install`.

Consumers must support `KHR_draco_mesh_compression` and `EXT_texture_webp`.
three.js needs `DRACOLoader` registered on the `GLTFLoader`:

```js
const draco = new DRACOLoader().setDecoderPath('/path/to/draco/');
gltfLoader.setDRACOLoader(draco);
```

## License

MIT
