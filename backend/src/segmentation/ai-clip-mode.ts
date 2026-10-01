/**
 * FULL cuts the whole episode into back-to-back clips that follow its topics.
 * HIGHLIGHTS keeps only the moments most likely to get reach and leaves the
 * rest of the episode out.
 */
export const AI_CLIP_MODES = ['FULL', 'HIGHLIGHTS'] as const;
export type AiClipMode = (typeof AI_CLIP_MODES)[number];

export const DEFAULT_AI_CLIP_MODE: AiClipMode = 'FULL';
