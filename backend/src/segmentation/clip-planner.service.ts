import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import type { TopicSegmentCandidate } from './boundary-reconciliation.service';

export interface PlannerTranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
  words?: unknown;
}

export interface CutPoint {
  /** A moment with nobody speaking, where a clip can start or end. */
  timeSec: number;
  /** The speaker finished a sentence right before this moment. */
  sentenceEnd: boolean;
  /** Seconds of silence around the cut. */
  gapSec: number;
}

export interface HighlightCandidate extends TopicSegmentCandidate {
  /** 1 to 10: how likely the moment is to get reach as a standalone reel. */
  score: number;
}

export type PlannedClip = TopicSegmentCandidate;

interface Draft extends TopicSegmentCandidate {
  score?: number;
}

const SENTENCE_ENDING = /[.!?؟۔…]["'”’)\]]*\s*$/u;

// A cut sits a little after the last word so the final syllable is never
// clipped, but never more than half of the silence that follows it.
const CUT_PAD_SEC = 0.3;
const PAUSE_CUT_MIN_GAP_SEC = 0.7;
const PUNCTUATION_FREE_SENTENCE_GAP_SEC = 0.5;
const DUPLICATE_CUT_SEC = 0.25;

// Cost of a cut, in seconds of distance from where the cut is wanted. A
// sentence end or a long silence makes a cut "closer" than it really is.
const SENTENCE_BONUS_SEC = 12;
const GAP_BONUS_PER_SEC = 4;
const GAP_BONUS_CAP_SEC = 2;

const SNAP_RADIUS_SEC = 20;
const EDGE_SNAP_SEC = 2;
const MIN_TOPIC_SEC = 1;
const MIN_USABLE_HIGHLIGHT_SEC = 5;

const MIN_HIGHLIGHT_SCORE = 6;
const MIN_HIGHLIGHT_COUNT = 3;
const MAX_HIGHLIGHT_COUNT = 20;
const SECONDS_PER_HIGHLIGHT = 300;
const OVERLAP_TOLERANCE_SEC = 1;

const MAX_TITLE_LENGTH = 120;
const MAX_SUMMARY_LENGTH = 500;
const PART_SUFFIX_RESERVE = 14;

@Injectable()
export class ClipPlannerService {
  readonly minSec: number;
  readonly maxSec: number;

  constructor(config: ConfigService<Env, true>) {
    const maxAllowed = config.get('CLIP_MAX_DURATION_SEC', { infer: true });
    this.maxSec = Math.min(
      config.get('AI_CLIP_MAX_DURATION_SEC', { infer: true }),
      maxAllowed,
    );
    this.minSec = Math.min(
      config.get('AI_CLIP_MIN_DURATION_SEC', { infer: true }),
      this.maxSec,
    );
  }

  /**
   * Finds every moment in the transcript where a clip can be cut without
   * interrupting someone: after each transcript segment and after each pause
   * between words.
   */
  buildCutPoints(
    segments: readonly PlannerTranscriptSegment[],
    videoDurationSec: number,
  ): CutPoint[] {
    const valid = segments
      .filter(
        (segment) =>
          Number.isFinite(segment.startSec) &&
          Number.isFinite(segment.endSec) &&
          segment.endSec > segment.startSec &&
          segment.text.trim().length > 0,
      )
      .sort((a, b) => a.startSec - b.startSec);

    const hasPunctuation = valid.some((segment) =>
      SENTENCE_ENDING.test(segment.text),
    );
    const cuts: CutPoint[] = [];

    valid.forEach((segment, index) => {
      const next = valid[index + 1];
      const gapSec = next ? Math.max(0, next.startSec - segment.endSec) : 0;
      cuts.push({
        timeSec: segment.endSec + Math.min(CUT_PAD_SEC, gapSec / 2),
        sentenceEnd: hasPunctuation
          ? SENTENCE_ENDING.test(segment.text)
          : gapSec >= PUNCTUATION_FREE_SENTENCE_GAP_SEC,
        gapSec: this.round(gapSec),
      });
    });

    const words = valid
      .flatMap((segment) => this.readWords(segment.words))
      .sort((a, b) => a.startSec - b.startSec);
    for (let index = 0; index < words.length - 1; index += 1) {
      const gapSec = words[index + 1].startSec - words[index].endSec;
      if (gapSec >= PAUSE_CUT_MIN_GAP_SEC) {
        cuts.push({
          timeSec: words[index].endSec + Math.min(CUT_PAD_SEC, gapSec / 2),
          sentenceEnd: false,
          gapSec: this.round(gapSec),
        });
      }
    }

    return this.dedupeCuts(
      cuts
        .map((cut) => ({ ...cut, timeSec: this.round(cut.timeSec) }))
        .filter(
          (cut) =>
            cut.timeSec > EDGE_SNAP_SEC &&
            cut.timeSec < videoDurationSec - EDGE_SNAP_SEC,
        ),
    );
  }

  /**
   * Turns consecutive topics that cover the whole video into clips. Topic
   * edges move to the nearest pause, topics shorter than the minimum join a
   * neighbour, and topics longer than the maximum are split into parts at
   * sentence ends.
   */
  planFull(
    topics: readonly TopicSegmentCandidate[],
    cuts: readonly CutPoint[],
    videoDurationSec: number,
    language: string,
  ): PlannedClip[] {
    if (topics.length === 0) return [];

    let drafts: Draft[] = [];
    let startSec = 0;
    topics.forEach((topic, index) => {
      const isLast = index === topics.length - 1;
      let endSec = videoDurationSec;
      if (!isLast) {
        const low = startSec + MIN_TOPIC_SEC;
        const high = topics[index + 1].endSec - MIN_TOPIC_SEC;
        endSec =
          low <= high
            ? this.snap(topic.endSec, low, high, cuts)
            : this.round(topic.endSec);
        if (endSec - startSec < MIN_TOPIC_SEC) return;
      }
      drafts.push({ ...topic, startSec, endSec });
      startSec = endSec;
    });

    drafts = this.mergeShort(drafts);
    this.rebalanceShort(drafts, cuts);

    return drafts
      .flatMap((draft) => this.splitLong(draft, cuts, language))
      .map((draft) => this.toPlanned(draft));
  }

  /**
   * Picks the moments most likely to get reach. Each one starts and ends at a
   * pause, lasts at least the minimum (growing forward, then backward, when the
   * model chose a shorter moment) and is split into parts only when the topic
   * itself runs past the maximum.
   */
  planHighlights(
    candidates: readonly HighlightCandidate[],
    cuts: readonly CutPoint[],
    videoDurationSec: number,
    language: string,
  ): PlannedClip[] {
    const snapped = candidates
      .map((candidate) => this.normalizeHighlight(candidate, videoDurationSec))
      .filter(
        (candidate): candidate is HighlightCandidate => candidate !== null,
      )
      .map((candidate) => ({
        ...candidate,
        startSec: this.snapStart(candidate.startSec, cuts),
        endSec: this.snapEnd(candidate.endSec, cuts, videoDurationSec),
      }))
      .filter(
        (candidate) =>
          candidate.endSec - candidate.startSec >= MIN_USABLE_HIGHLIGHT_SEC,
      )
      .sort((a, b) => b.score - a.score || a.startSec - b.startSec);

    const cap = Math.min(
      MAX_HIGHLIGHT_COUNT,
      Math.max(
        MIN_HIGHLIGHT_COUNT,
        Math.ceil(videoDurationSec / SECONDS_PER_HIGHLIGHT),
      ),
    );
    const selected: Draft[] = [];

    for (const candidate of snapped) {
      if (selected.length >= cap) break;
      if (
        candidate.score < MIN_HIGHLIGHT_SCORE &&
        selected.length >= MIN_HIGHLIGHT_COUNT
      ) {
        break;
      }
      const overlaps = selected.some(
        (other) =>
          Math.min(candidate.endSec, other.endSec) -
            Math.max(candidate.startSec, other.startSec) >
          OVERLAP_TOLERANCE_SEC,
      );
      if (overlaps) continue;

      const low = Math.max(
        0,
        ...selected
          .filter(
            (other) =>
              other.endSec <= candidate.startSec + OVERLAP_TOLERANCE_SEC,
          )
          .map((other) => other.endSec),
      );
      const high = Math.min(
        videoDurationSec,
        ...selected
          .filter(
            (other) =>
              other.startSec >= candidate.endSec - OVERLAP_TOLERANCE_SEC,
          )
          .map((other) => other.startSec),
      );
      const fitted = this.fitHighlight(
        candidate.startSec,
        candidate.endSec,
        low,
        high,
        cuts,
        videoDurationSec,
      );
      if (fitted) selected.push({ ...candidate, ...fitted });
    }

    return selected
      .sort((a, b) => a.startSec - b.startSec)
      .flatMap((draft) => this.splitLong(draft, cuts, language))
      .map((draft) => this.toPlanned(draft));
  }

  private mergeShort(input: Draft[]): Draft[] {
    const drafts = [...input];
    const stuck = new Set<Draft>();

    for (;;) {
      let index = -1;
      let shortest = Number.POSITIVE_INFINITY;
      drafts.forEach((draft, position) => {
        const length = this.length(draft);
        if (length < this.minSec && !stuck.has(draft) && length < shortest) {
          shortest = length;
          index = position;
        }
      });
      if (index < 0) return drafts;

      const current = drafts[index];
      const neighbours = [index - 1, index + 1].filter(
        (position) =>
          position >= 0 &&
          position < drafts.length &&
          this.length(drafts[position]) + this.length(current) <= this.maxSec,
      );
      if (neighbours.length === 0) {
        stuck.add(current);
        continue;
      }

      const target = neighbours.reduce((best, position) =>
        this.length(drafts[position]) < this.length(drafts[best])
          ? position
          : best,
      );
      const neighbour = drafts[target];
      const merged: Draft = {
        title:
          this.length(neighbour) >= this.length(current)
            ? neighbour.title
            : current.title,
        summary: this.join(
          target < index ? neighbour.summary : current.summary,
          target < index ? current.summary : neighbour.summary,
        ),
        startSec: Math.min(current.startSec, neighbour.startSec),
        endSec: Math.max(current.endSec, neighbour.endSec),
      };
      drafts.splice(Math.min(index, target), 2, merged);
    }
  }

  // A short clip that could not join a neighbour (it would pass the maximum)
  // borrows time from the neighbour by moving the shared cut.
  private rebalanceShort(drafts: Draft[], cuts: readonly CutPoint[]): void {
    drafts.forEach((draft, index) => {
      const missing = this.minSec - this.length(draft);
      if (missing <= 0) return;

      const after = drafts[index + 1];
      if (after && this.length(after) - missing >= this.minSec) {
        const cut = this.pick(
          cuts,
          draft.endSec + missing,
          draft.startSec + this.minSec,
          after.endSec - this.minSec,
        );
        if (cut && draft.startSec + this.maxSec >= cut.timeSec) {
          draft.endSec = cut.timeSec;
          after.startSec = cut.timeSec;
          return;
        }
      }

      const before = drafts[index - 1];
      if (before && this.length(before) - missing >= this.minSec) {
        const cut = this.pick(
          cuts,
          draft.startSec - missing,
          before.startSec + this.minSec,
          draft.endSec - this.minSec,
        );
        if (cut && draft.endSec - this.maxSec <= cut.timeSec) {
          draft.startSec = cut.timeSec;
          before.endSec = cut.timeSec;
        }
      }
    });
  }

  private splitLong(
    draft: Draft,
    cuts: readonly CutPoint[],
    language: string,
  ): Draft[] {
    const duration = this.length(draft);
    if (duration <= this.maxSec) return [draft];

    const parts = Math.ceil(duration / this.maxSec);
    const boundaries = [draft.startSec];
    for (let part = 1; part < parts; part += 1) {
      const previous = boundaries[boundaries.length - 1];
      const remaining = parts - part;
      const target = draft.startSec + (duration * part) / parts;
      let low = Math.max(
        previous + this.minSec,
        draft.endSec - remaining * this.maxSec,
      );
      let high = Math.min(
        previous + this.maxSec,
        draft.endSec - remaining * this.minSec,
      );
      if (low > high) {
        low = previous + 1;
        high = draft.endSec - remaining;
      }
      const cut = this.pick(cuts, target, low, high);
      boundaries.push(
        cut ? cut.timeSec : this.round(Math.min(Math.max(target, low), high)),
      );
    }
    boundaries.push(draft.endSec);

    const word = language.toLowerCase().startsWith('ar') ? 'جزء' : 'Part';
    const base = this.truncate(
      draft.title,
      MAX_TITLE_LENGTH - PART_SUFFIX_RESERVE,
    );
    return Array.from({ length: parts }, (_, part) => ({
      ...draft,
      title: `${base} (${word} ${part + 1})`,
      startSec: boundaries[part],
      endSec: boundaries[part + 1],
    }));
  }

  private fitHighlight(
    start: number,
    end: number,
    low: number,
    high: number,
    cuts: readonly CutPoint[],
    videoDurationSec: number,
  ): { startSec: number; endSec: number } | null {
    let startSec = Math.max(start, low);
    let endSec = Math.min(end, high);

    if (endSec - startSec < this.minSec) {
      const limit = Math.min(high, startSec + this.maxSec);
      const cut = this.pick(
        cuts,
        startSec + this.minSec,
        startSec + this.minSec,
        limit,
      );
      if (cut) {
        endSec = cut.timeSec;
      } else if (limit >= videoDurationSec) {
        endSec = videoDurationSec;
      } else {
        const nearest = this.pick(cuts, limit, endSec + 0.5, limit);
        if (nearest) endSec = nearest.timeSec;
      }
    }

    if (endSec - startSec < this.minSec) {
      const limit = Math.max(low, endSec - this.maxSec);
      const cut = this.pick(
        cuts,
        endSec - this.minSec,
        limit,
        endSec - this.minSec,
      );
      if (cut) {
        startSec = cut.timeSec;
      } else if (limit <= 0) {
        startSec = 0;
      } else {
        const nearest = this.pick(cuts, limit, limit, startSec - 0.5);
        if (nearest) startSec = nearest.timeSec;
      }
    }

    return endSec - startSec >= this.minSec / 2 ? { startSec, endSec } : null;
  }

  private normalizeHighlight(
    candidate: HighlightCandidate,
    videoDurationSec: number,
  ): HighlightCandidate | null {
    const startSec = Math.max(0, candidate.startSec);
    const endSec = Math.min(videoDurationSec, candidate.endSec);
    if (
      !Number.isFinite(startSec) ||
      !Number.isFinite(endSec) ||
      endSec <= startSec ||
      !Number.isFinite(candidate.score)
    ) {
      return null;
    }
    return { ...candidate, startSec, endSec };
  }

  private snapStart(timeSec: number, cuts: readonly CutPoint[]): number {
    if (timeSec <= EDGE_SNAP_SEC) return 0;
    return this.snap(
      timeSec,
      timeSec - SNAP_RADIUS_SEC,
      timeSec + SNAP_RADIUS_SEC,
      cuts,
      false,
    );
  }

  private snapEnd(
    timeSec: number,
    cuts: readonly CutPoint[],
    videoDurationSec: number,
  ): number {
    if (videoDurationSec - timeSec <= EDGE_SNAP_SEC) return videoDurationSec;
    return this.snap(
      timeSec,
      timeSec - SNAP_RADIUS_SEC,
      timeSec + SNAP_RADIUS_SEC,
      cuts,
      false,
    );
  }

  /** Nearest good cut inside [low, high]; the wanted time itself if none. */
  private snap(
    target: number,
    low: number,
    high: number,
    cuts: readonly CutPoint[],
    widenWhenEmpty = true,
  ): number {
    const near = this.pick(
      cuts,
      target,
      Math.max(low, target - SNAP_RADIUS_SEC),
      Math.min(high, target + SNAP_RADIUS_SEC),
    );
    if (near) return near.timeSec;
    const any = widenWhenEmpty ? this.pick(cuts, target, low, high) : null;
    return any
      ? any.timeSec
      : this.round(Math.min(Math.max(target, low), high));
  }

  private pick(
    cuts: readonly CutPoint[],
    target: number,
    low: number,
    high: number,
  ): CutPoint | null {
    let best: CutPoint | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const cut of cuts) {
      if (cut.timeSec < low || cut.timeSec > high) continue;
      const cost =
        Math.abs(cut.timeSec - target) -
        (cut.sentenceEnd ? SENTENCE_BONUS_SEC : 0) -
        Math.min(cut.gapSec, GAP_BONUS_CAP_SEC) * GAP_BONUS_PER_SEC;
      if (cost < bestCost) {
        best = cut;
        bestCost = cost;
      }
    }
    return best;
  }

  private dedupeCuts(cuts: CutPoint[]): CutPoint[] {
    const sorted = [...cuts].sort((a, b) => a.timeSec - b.timeSec);
    const result: CutPoint[] = [];
    for (const cut of sorted) {
      const previous = result[result.length - 1];
      if (previous && cut.timeSec - previous.timeSec < DUPLICATE_CUT_SEC) {
        if (cut.sentenceEnd && !previous.sentenceEnd) {
          result[result.length - 1] = cut;
        }
        continue;
      }
      result.push(cut);
    }
    return result;
  }

  private readWords(value: unknown): { startSec: number; endSec: number }[] {
    if (!Array.isArray(value)) return [];
    const words: { startSec: number; endSec: number }[] = [];
    for (const item of value as unknown[]) {
      if (typeof item !== 'object' || item === null) continue;
      const { startSec, endSec } = item as Record<string, unknown>;
      if (
        typeof startSec === 'number' &&
        typeof endSec === 'number' &&
        Number.isFinite(startSec) &&
        Number.isFinite(endSec)
      ) {
        words.push({ startSec, endSec });
      }
    }
    return words;
  }

  private toPlanned(draft: Draft): PlannedClip {
    return {
      title: this.truncate(draft.title, MAX_TITLE_LENGTH),
      startSec: this.round(draft.startSec),
      endSec: this.round(draft.endSec),
      summary: this.truncate(draft.summary, MAX_SUMMARY_LENGTH),
    };
  }

  private join(left: string, right: string): string {
    return this.truncate(`${left} ${right}`, MAX_SUMMARY_LENGTH);
  }

  private truncate(value: string, limit: number): string {
    return value.length > limit ? value.slice(0, limit).trimEnd() : value;
  }

  private length(draft: Draft): number {
    return draft.endSec - draft.startSec;
  }

  private round(value: number): number {
    return Math.round(value * 1000) / 1000;
  }
}
