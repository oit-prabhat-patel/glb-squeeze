// Topology-ignoring ("sloppy") simplification for aggressive LOD roles.
//
// meshopt's standard simplifier preserves topology, so it cannot collapse across
// the thousands of disconnected islands that generator/scan models are made of —
// it floors far above the target (a raw 2M-tri diya stops at ~400k no matter the
// ratio, error, weld, or border setting). `simplifySloppy` ignores topology and
// attributes and reaches any target, so props and particles actually hit their
// budget. The trade is UV/shape distortion — fine for small or in-bulk items,
// never for a hero.
//
// We only touch geometry here (writing an uncompressed intermediate GLB); the
// caller's `gltf-transform optimize --simplify false` pass then welds, prunes the
// now-unused vertices, resizes textures, and Draco-compresses.

import { NodeIO } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';

export async function sloppySimplify(inputPath, outputPath, ratio) {
  await MeshoptSimplifier.ready;
  const io = new NodeIO();
  const doc = await io.read(inputPath);

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idxAcc = prim.getIndices();
      const posAcc = prim.getAttribute('POSITION');
      if (!idxAcc || !posAcc) continue; // non-indexed / positionless — leave as is

      const indices = Uint32Array.from(idxAcc.getArray());
      const positions = Float32Array.from(posAcc.getArray());
      const target = Math.max(1, Math.round(indices.length / 3 * ratio)) * 3;
      if (target >= indices.length) continue; // already at/under budget

      // target_error high (1.0) so it reaches the target ratio rather than
      // stopping early — the point of sloppy is a predictable, consistent LOD.
      const [dst] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, target, 1.0);
      idxAcc.setArray(new Uint32Array(dst)); // references a subset; optimize prunes the rest
    }
  }

  await io.write(outputPath, doc);
}
