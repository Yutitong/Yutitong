// Which body axis a "wrap around" image winds around, based on where it is placed.
import { ARM_DIR, ARM_ROOT, Y_CROTCH, legCenterX } from '../geometry/body.js';

// Above this height a band on the trousers wraps the whole hips instead of one leg.
const HIP_BAND_Y = Y_CROTCH + 4;

function normalize(v) {
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
}

// `side` restricts a leg band to its own half of the body (+1 = x > 0, -1 = x < 0,
// 0 = no restriction). It fades out softly at the centre line rather than stopping at
// a seam, so the print stays continuous across every seam.
export function wrapAxisFor(pieceId, point) {
  const side = pieceId.endsWith('right') ? -1 : 1;
  if (pieceId.startsWith('sleeve')) {
    return {
      origin: [ARM_ROOT[0] * side, ARM_ROOT[1], ARM_ROOT[2]],
      dir: [ARM_DIR[0] * side, ARM_DIR[1], ARM_DIR[2]],
      side: 0,
    };
  }
  if (pieceId.startsWith('leg') && point[1] < HIP_BAND_Y) {
    const x0 = legCenterX(0) * side;
    const x1 = legCenterX(Y_CROTCH) * side;
    return { origin: [x0, 0, 0], dir: normalize([x1 - x0, Y_CROTCH, 0]), side };
  }
  return { origin: [0, 0, 0], dir: [0, 1, 0], side: 0 };
}
