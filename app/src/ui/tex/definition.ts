/**
 * Tex has a face, and it is data rather than a pile of components.
 *
 * The separation is worth stating because it is the whole design: one
 * renderer (`Face.tsx`) that knows how to draw a body and two eyes, and a
 * table of named expressions that knows nothing about drawing. Adding a mood
 * is editing this file. Nothing below imports Solid, and nothing below draws.
 *
 * ON WHERE THIS SHAPE CAME FROM. The interchange schema is Stéphane
 * Montlouis-Calixte's `bible-strong/avatar-definition` - a body blob, two
 * rounded-rect eyes, head rotation, and animations as steps between named
 * expressions. His studio (avatars.bible-strong.app) is a genuinely good tool
 * and the idea of expressions-as-data is his.
 *
 * What is NOT his: every number in this file, and every line of the renderer.
 * The three `@bible-strong/avatar-*` runtime packages are AGPL-3.0-only, and
 * TargetX ships BUSL-1.1 desktop installers - the two cannot govern one
 * binary, so linking his renderer is not available to us. A file format is
 * interoperability, not authorship; his artwork and his implementation are
 * his, and neither is here. Tex's proportions and palette are ours, and the
 * geometry below was written against the schema's field names alone. If the
 * dual-licence conversation ever happens, this file is what gets deleted.
 */

/** A capsule eye. `angle` tilts it; a tilted pair is most of an emotion. */
export interface Eye {
  readonly width: number;
  readonly height: number;
  /** Offset from the eye's resting place, in body units. */
  readonly x: number;
  readonly y: number;
  /** Degrees, clockwise. */
  readonly angle: number;
}

export interface Expression {
  /** Head rotation in degrees: yaw, pitch, roll. */
  readonly head: { readonly x: number; readonly y: number; readonly z: number };
  readonly eyes: {
    readonly left: Eye;
    readonly right: Eye;
    /** Half the gap between the eyes' centres. */
    readonly spacing: number;
  };
  /**
   * How hard the head rotation displaces the eyes.
   *
   * The body is a flat shape pretending to have a front. Turning the head
   * slides the eyes across it and squashes the silhouette a little; this
   * scales that lie. Zero draws the eyes dead centre however far the head has
   * turned, which reads as a sticker rather than a face.
   */
  readonly perspective: number;
}

export interface AvatarDefinition {
  readonly name: string;
  readonly body: {
    readonly width: number;
    readonly height: number;
    /**
     * 1 is an ellipse; below 1 squares the corners toward a squircle.
     *
     * Implemented as a superellipse exponent in the renderer, which is the
     * obvious way to get one shape to travel between round and boxy without
     * a second path.
     */
    readonly roundness: number;
  };
  readonly colors: { readonly body: string; readonly eyes: string };
  readonly expressions: Readonly<Record<string, Expression>>;
}

const eye = (
  width: number, height: number, x = 0, y = 0, angle = 0,
): Eye => ({ width, height, x, y, angle });

const pair = (e: Eye, spacing = 35): Expression["eyes"] =>
  ({ left: e, right: e, spacing });

/**
 * Tex.
 *
 * A verdigris blob at the app's own brand hue, because he is the app
 * speaking and not a character visiting it. Deliberately eyes-only: a mouth
 * would have to say something about news he is often delivering badly, and
 * an eyebrow-less blob reading "concerned" is kinder than a frown.
 *
 * The four moods are not decoration - they are the four verdicts the engine
 * already computes per subject, so his face can never disagree with the
 * number beside it. See `expressions.ts`.
 */
export const TEX: AvatarDefinition = {
  name: "Tex",
  body: { width: 240, height: 240, roundness: 1 },
  colors: { body: "var(--brand)", eyes: "var(--on-brand)" },

  expressions: {
    /** Resting. Tall capsules, level, looking straight out. */
    neutral: {
      head: { x: 0, y: 0, z: 0 },
      eyes: pair(eye(26, 58, 0, -4), 38),
      perspective: 1,
    },

    /**
     * Pleased - the SAFE verdict.
     *
     * Squashed and raised rather than curved: a capsule shortened from the
     * bottom reads as a happy squint, and it costs no extra geometry.
     */
    pleased: {
      head: { x: -4, y: 0, z: 0 },
      eyes: pair(eye(32, 18, 0, -12), 36),
      perspective: 1,
    },

    /**
     * Concerned - TIGHT. Room left, but not much.
     *
     * The tilt is the whole expression. Inner ends lifted by four degrees in
     * mirror is the smallest change on this face that still reads as worry,
     * and anything larger reads as anger.
     */
    concerned: {
      head: { x: 3, y: -6, z: 0 },
      eyes: {
        left: eye(22, 46, 2, -2, -14),
        right: eye(22, 46, -2, -2, 14),
        spacing: 38,
      },
      perspective: 1.1,
    },

    /**
     * Alarmed - SHORTAGE. The line is already crossed.
     *
     * Wide and round, pulled slightly apart. Note it does not tilt: a
     * shortage is not disapproval of the student, and an angry face here
     * would be the app blaming them for a number it just calculated.
     */
    alarmed: {
      head: { x: 0, y: 0, z: 0 },
      eyes: pair(eye(42, 48, 0, -4), 46),
      perspective: 1.2,
    },

    /** Mid-blink. Held for a few frames by the renderer, never selected. */
    blink: {
      head: { x: 0, y: 0, z: 0 },
      eyes: pair(eye(28, 5, 0, -4), 38),
      perspective: 1,
    },
  },
};

export type Mood = "neutral" | "pleased" | "concerned" | "alarmed";
