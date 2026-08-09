// Drawing: EXIF rotation and downscaling, baked into a canvas.
//
// Kept apart from the worker so the orientation maths can be tested directly.
// Getting this wrong shows up as sideways photos, which is the most visible
// bug this app could possibly ship.

/**
 * Draw `source` onto a new OffscreenCanvas, applying EXIF `orientation` and
 * shrinking so the long edge is at most `maxDim` (0 means leave it alone).
 *
 * `srcW`/`srcH` are the source's own dimensions, before any rotation.
 */
export function render(source, srcW, srcH, orientation = 1, maxDim = 0) {
  // Orientations 5 to 8 turn the image a quarter turn, so the output is the
  // other way round.
  const quarterTurn = orientation >= 5 && orientation <= 8;
  const uprightW = quarterTurn ? srcH : srcW;
  const uprightH = quarterTurn ? srcW : srcH;

  let scale = 1;
  if (maxDim && Math.max(uprightW, uprightH) > maxDim) {
    scale = maxDim / Math.max(uprightW, uprightH);
  }

  const outW = Math.max(1, Math.round(uprightW * scale));
  const outH = Math.max(1, Math.round(uprightH * scale));

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Scale first, then move into the rotated frame using unscaled distances:
  // the transform applies the scale to them for us.
  ctx.save();
  ctx.scale(scale, scale);
  switch (orientation) {
    case 2:                                                    // mirror across
      ctx.translate(srcW, 0); ctx.scale(-1, 1); break;
    case 3:                                                    // half turn
      ctx.translate(srcW, srcH); ctx.rotate(Math.PI); break;
    case 4:                                                    // mirror down
      ctx.translate(0, srcH); ctx.scale(1, -1); break;
    case 5:                                                    // transpose
      ctx.rotate(0.5 * Math.PI); ctx.scale(1, -1); break;
    case 6:                                                    // quarter turn clockwise
      ctx.translate(srcH, 0); ctx.rotate(0.5 * Math.PI); break;
    case 7:                                                    // transverse
      // Flip has to be composed before the turn, not after, or the image
      // lands entirely outside the canvas.
      ctx.translate(srcH, srcW); ctx.scale(1, -1); ctx.rotate(0.5 * Math.PI); break;
    case 8:                                                    // quarter turn anticlockwise
      ctx.translate(0, srcW); ctx.rotate(-0.5 * Math.PI); break;
    default:
      break;
  }
  ctx.drawImage(source, 0, 0);
  ctx.restore();
  return canvas;
}
