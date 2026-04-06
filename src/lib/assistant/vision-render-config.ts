/**
 * PDF page raster size for vision / multimodal calls.
 * Local runtimes (e.g. llama.cpp + gemma) need smaller `-scale-to` to stay within time bounds;
 * online endpoints keep the default unless LOCAL_MULTIMODAL_RUNTIME is set.
 */

const DEFAULT_MAX_RENDER = 2048;
const DEFAULT_LOCAL_MAX_RENDER = 1024;
const MIN_SIDE = 256;
const MAX_SIDE = 8192;

/**
 * When true, `getVisionMaxRenderSize()` uses VISION_LOCAL_MAX_RENDER_SIZE instead of VISION_MAX_RENDER_SIZE.
 * Opt-in only — no LAN auto-detection, so intranet production APIs are not accidentally shrunk.
 */
export function isLocalMultimodalRuntime(): boolean {
  return (
    process.env.LOCAL_MULTIMODAL_RUNTIME === '1' || process.env.VISION_USE_LOCAL_RENDER_SIZE === '1'
  );
}

function clampSide(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_MAX_RENDER;
  return Math.min(Math.max(Math.round(n), MIN_SIDE), MAX_SIDE);
}

/**
 * Longer edge target for `pdftoppm -scale-to` when rasterizing PDF pages for vision.
 */
export function getVisionMaxRenderSize(): number {
  if (isLocalMultimodalRuntime()) {
    const raw = Number(process.env.VISION_LOCAL_MAX_RENDER_SIZE ?? DEFAULT_LOCAL_MAX_RENDER);
    return clampSide(raw);
  }
  const raw = Number(process.env.VISION_MAX_RENDER_SIZE ?? DEFAULT_MAX_RENDER);
  return clampSide(raw);
}
