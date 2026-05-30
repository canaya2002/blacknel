/** Shared media helpers for connector publishers (C47). Pure, no deps. */

const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v)(\?|$)/i;

/** Infer video-vs-image from the URL extension (R2 keys carry the ext). */
export function isVideoUrl(url: string): boolean {
  return VIDEO_EXT_RE.test(url);
}
