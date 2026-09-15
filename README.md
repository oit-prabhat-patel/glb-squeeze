# glb-squeeze

Batch-compress GLB/glTF models for mobile and web delivery. A thin, opinionated
wrapper around [glTF-Transform](https://gltf-transform.dev/) that turns a folder
of 60 MB "download from an asset generator" models into ~1.4 MB files you can
actually ship over a mobile connection.

Typical result on generated (photogrammetry/AI) murti and prop models:

```
29 models
1657 MB → 40 MB   (41.6x smaller, 97.6% saved)
```

Per-model results ranged from **36x to 50x**, landing every file between
1.2 MB and 1.7 MB regardless of what it started at.

## Quick start

```bash
npm install
./squeeze.sh ~/models ~/models-compressed
```

Originals are never modified — outputs are written to the target folder under
the same filenames, plus a `_squeeze/` folder holding per-file logs and a `squeeze-report.csv`
with before/after bytes.

## Tuning

All knobs are environment variables:

| Var | Default | What it does |
|---|---|---|
| `RATIO` | `0.15` | Fraction of vertices to keep. The single biggest lever. |
| `ERROR` | `0.001` | Simplification error tolerance, as a fraction of mesh extent. |
| `TEX_SIZE` | `2048` | Max texture dimension in px. |
| `TEX_FORMAT` | `webp` | `webp`, `avif`, `ktx2`, or `auto`. See the VRAM note below. |
| `COMPRESS` | `draco` | `draco`, `meshopt`, or `quantize`. |
| `JOBS` | `4` | Files processed in parallel. |

```bash
# Hero asset — keep more geometry
RATIO=0.35 TEX_SIZE=4096 ./squeeze.sh ./in ./out

# Background props shown small or in bulk — go hard
RATIO=0.05 TEX_SIZE=1024 ./squeeze.sh ./in ./out
```

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
| `--frames` / `--fps` | `30` / `15` | Loop length. 30 @ 15 = a 2s loop. |
| `--amp` | `14` | Sway half-angle in degrees. |
| `--anchorX` / `--anchorY` | `0.72` / `0.46` | Where the subject sits in frame (0–1). |
| `--fill` | `0.78` | Subject height as a fraction of canvas height. |
| `--w` / `--h` | `720` / `432` | Output size. |
| `--q` | `72` | WebP quality. |

The sway is `sin(2π·phase)`, so the last frame meets the first exactly and the
loop has no visible seam. A `-still.png` is written next to the output for
checking framing without decoding the animation.

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
