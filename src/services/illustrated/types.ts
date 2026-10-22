/**
 * Illustrated chapter videos: instead of one still cover, a chapter becomes a series of
 * scenes with the story's own characters. The characters are drawn once per story (the
 * "bible", written by the agent as small SVG pieces the person can review) and every scene
 * reuses those exact pieces, so a character looks the same in every chapter — only the
 * expression, place, time of day and position change.
 */
export const EXPRESSIONS = ["neutral", "smile", "sad", "surprised", "laugh"] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export const PLACES = ["field", "desert", "indoor", "forest", "city", "sea", "snow"] as const;
export type Place = (typeof PLACES)[number];

export const TIMES = ["day", "dusk", "night"] as const;
export type TimeOfDay = (typeof TIMES)[number];

export const SPOTS = ["left", "center", "right"] as const;
export type Spot = (typeof SPOTS)[number];

export interface Character {
  id: string;
  name: string;
  // What the agent read about them (age, hair, clothes) — shown so the person can judge the drawing.
  description: string;
  // Sanitized SVG, local coordinates: feet at (0,0), about 430 tall, facing right, no face.
  body: string;
  // Head centre, negative y (the face pieces are drawn around (0,0) and moved there).
  headY: number;
  faces: Record<Expression, string>;
}

export interface Bible {
  // One line naming the drawing style, repeated to the agent for every later request.
  style: string;
  characters: Character[];
  createdAt: string;
}

export interface SceneCast {
  id: string;
  spot: Spot;
  expression: Expression;
}

export interface Scene {
  // Inclusive indexes into the chapter's narration parts.
  fromPart: number;
  toPart: number;
  place: Place;
  time: TimeOfDay;
  cast: SceneCast[];
}

export interface Storyboard {
  scenes: Scene[];
}

// A scene with real seconds, ready to be laid out.
export interface TimedScene extends Scene {
  from: number;
  to: number;
  captions: { text: string; from: number; to: number }[];
}
