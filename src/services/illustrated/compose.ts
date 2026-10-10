import fs from "fs/promises";
import path from "path";
import { scenery, FLOOR_Y } from "./scenery";
import { Bible, Character, SceneCast, Spot, TimedScene } from "./types";

/**
 * Writes a HyperFrames project (index.html + one sub-composition per scene) for a chapter:
 * the characters' own SVG pieces, a flat landscape per scene, the narration's parts as
 * captions, and a few seek-safe GSAP tweens (idle bob, slow zoom, crossfade). The video has
 * no audio here — the narration (and background music) is muxed in afterwards by ffmpeg.
 */
const FADE = 0.33;
const SPOT_X: Record<Spot, number> = { left: 520, center: 960, right: 1400 };

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function actor(character: Character, member: SceneCast, count: number, className: string): string {
  const x = count === 1 && member.spot === "center" ? SPOT_X.center : SPOT_X[member.spot];
  const scale = count === 1 ? 1.3 : count === 2 ? 1.2 : 1.05;
  const flip = x > 960 ? -1 : 1;
  return (
    `<g transform="translate(${x} ${FLOOR_Y}) scale(${scale * flip} ${scale})"><g class="${className}">` +
    character.body +
    `<g transform="translate(0 ${character.headY})">${character.faces[member.expression]}</g>` +
    `</g></g>`
  );
}

// `still` makes a frame meant for a snapshot: no motion, no captions, no crossfade; `badge`
// is a small label (the chapter number) for a compilation, where nothing else says where you are.
export interface SceneOptions {
  still?: boolean;
  badge?: string;
}

export function sceneHtml(scene: TimedScene, index: number, isLast: boolean, bible: Bible, options: SceneOptions = {}): string {
  const p = `s${index}`;
  const duration = scene.to - scene.from;
  const length = duration + (isLast ? 0 : FADE);
  const byId = new Map(bible.characters.map((character) => [character.id, character]));
  const actors = scene.cast
    .map((member) => {
      const character = byId.get(member.id);
      return character ? actor(character, member, scene.cast.length, `${p}-bob`) : "";
    })
    .join("");
  const captions = (options.still ? [] : scene.captions).map((caption, k) => `<div class="cap ${p}-cap${k}"><span>${escapeHtml(caption.text)}</span></div>`).join("");
  const tweens: string[] = [];
  // A still frame has nothing moving: an empty timeline keeps the scene a valid sub-composition.
  if (!options.still) {
    if (index > 0) tweens.push(`tl.fromTo("#root",{opacity:0},{opacity:1,duration:${FADE},ease:"none"},0);`);
    const zoom: [number, number] = index % 2 === 0 ? [1, 1.06] : [1.06, 1];
    tweens.push(`tl.fromTo(".${p}-stage",{scale:${zoom[0]}},{scale:${zoom[1]},duration:${length.toFixed(2)},ease:"none",transformOrigin:"50% 50%"},0);`);
    if (scene.cast.length > 0) {
      tweens.push(`tl.to(".${p}-bob",{y:4,duration:1.4,ease:"sine.inOut",yoyo:true,repeat:${Math.max(0, Math.floor(length / 1.4) - 1)}},0);`);
    }
    scene.captions.forEach((caption, k) => {
      tweens.push(`tl.fromTo(".${p}-cap${k}",{opacity:0},{opacity:1,duration:0.25},${caption.from.toFixed(2)});`);
      tweens.push(`tl.set(".${p}-cap${k}",{opacity:0},${Math.min(caption.to, length).toFixed(2)});`);
    });
  }
  const badge = options.badge ? `<div class="badge">${escapeHtml(options.badge)}</div>` : "";
  return `<!doctype html>
<html><head><meta charset="UTF-8" /></head><body>
<template>
<style>
  #root { position: absolute; inset: 0; overflow: hidden; font-family: Helvetica, Arial, sans-serif; }
  .${p}-stage { position: absolute; inset: 0; }
  .${p}-stage svg { display: block; }
  .badge { position: absolute; left: 48px; top: 40px; background: rgba(10,10,30,0.62); color: #fff; font-size: 40px; font-weight: 700; padding: 10px 26px; border-radius: 16px; }
  .cap { position: absolute; left: 120px; right: 120px; bottom: 48px; text-align: center; opacity: 0; }
  .cap span { display: inline-block; background: rgba(10,10,30,0.62); color: #fff; font-size: 44px; line-height: 1.3; padding: 12px 28px; border-radius: 18px; }
</style>
<div id="root" data-composition-id="scene-${index}" data-width="1920" data-height="1080">
  <div class="${p}-stage"><svg viewBox="0 0 1920 1080" width="1920" height="1080">${scenery(scene.place, scene.time, p)}${actors}</svg></div>
  ${captions}
  ${badge}
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  ${tweens.join("\n  ")}
  window.__timelines["scene-${index}"] = tl;
</script>
</template>
</body></html>
`;
}

export interface ComposeInput {
  dir: string;
  bible: Bible;
  scenes: TimedScene[];
  seconds: number;
  storyTitle: string;
  chapterTitle: string;
}

export async function composeProject(input: ComposeInput): Promise<void> {
  const { dir, scenes } = input;
  await fs.mkdir(path.join(dir, "compositions"), { recursive: true });
  await fs.copyFile(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
  await Promise.all(
    scenes.map((scene, index) =>
      fs.writeFile(path.join(dir, "compositions", `scene-${index}.html`), sceneHtml(scene, index, index === scenes.length - 1, input.bible))
    )
  );
  const hosts = scenes
    .map((scene, index) => {
      const length = scene.to - scene.from + (index === scenes.length - 1 ? 0 : FADE);
      return `      <div id="scene-${index}" data-composition-id="scene-${index}" data-composition-src="compositions/scene-${index}.html" data-start="${scene.from.toFixed(2)}" data-duration="${length.toFixed(2)}" data-track-index="${1 + (index % 2)}" data-width="1920" data-height="1080"></div>`;
    })
    .join("\n");
  await fs.writeFile(
    path.join(dir, "index.html"),
    `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #000; }
      #root { position: relative; width: 100%; height: 100%; font-family: Helvetica, Arial, sans-serif; }
      #title { width: 1920px; height: 1080px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.35); color: #fff; text-align: center; }
      #title .a { font-size: 56px; opacity: 0.85; }
      #title .b { font-size: 96px; font-weight: 800; max-width: 1600px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${input.seconds.toFixed(2)}" data-width="1920" data-height="1080">
${hosts}
      <div id="title" class="clip" data-start="0" data-duration="2.6" data-track-index="5"><div><div class="a">${escapeHtml(input.storyTitle)}</div><div class="b">${escapeHtml(input.chapterTitle)}</div></div></div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#title", { opacity: 0 }, { opacity: 1, duration: 0.33, ease: "none" }, 0);
      tl.to("#title", { opacity: 0, duration: 0.5, ease: "none" }, 2.0);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`
  );
}

// A project of one second per slide, so `hyperframes snapshot --at <i+0.5>` yields slide i.
export async function composeStillProject(
  dir: string,
  bible: Bible,
  slides: { scene: TimedScene; badge: string }[]
): Promise<void> {
  await fs.mkdir(path.join(dir, "compositions"), { recursive: true });
  await fs.copyFile(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
  await Promise.all(
    slides.map((slide, index) =>
      fs.writeFile(
        path.join(dir, "compositions", `scene-${index}.html`),
        sceneHtml(slide.scene, index, true, bible, { still: true, badge: slide.badge })
      )
    )
  );
  const hosts = slides
    .map(
      (_slide, index) =>
        `      <div id="scene-${index}" data-composition-id="scene-${index}" data-composition-src="compositions/scene-${index}.html" data-start="${index}" data-duration="1" data-track-index="${1 + (index % 2)}" data-width="1920" data-height="1080"></div>`
    )
    .join("\n");
  await fs.writeFile(
    path.join(dir, "index.html"),
    `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #000; }
      #root { position: relative; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${slides.length}" data-width="1920" data-height="1080">
${hosts}
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`
  );
}
