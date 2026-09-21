import { test, expect } from "../helpers/fixtures";
import { FIXTURE_URL } from "../helpers/env";

test("serves chapter pages the renderer will accept", async ({ request }) => {
  const res = await request.get(`${FIXTURE_URL}/truyen/fixture-a/chuong-1`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  // renderer.ts requires >= 1500 chars of HTML and >= 500 chars of settled text.
  expect(html.length).toBeGreaterThan(1500);
  expect(html).toContain("E2E-fixture-a-1-0");
});

test("flaky mode blanks the first hits, then serves the page", async ({ request }) => {
  // The counter lives for the fixture process's lifetime; a nonce gives every run a
  // fresh key so a Playwright retry of this test sees the blanking again.
  const url = `${FIXTURE_URL}/truyen/fixture-flaky/chuong-1?mode=flaky&fails=1&nonce=${Date.now()}`;
  const first = await (await request.get(url)).text();
  expect(first).not.toContain("E2E-fixture-flaky");
  const second = await (await request.get(url)).text();
  expect(second).toContain("E2E-fixture-flaky-1-0");
});

test("locked mode carries the Vietnamese anti-adblock notice", async ({ request }) => {
  const html = await (
    await request.get(`${FIXTURE_URL}/truyen/fixture-locked/chuong-1?mode=locked`)
  ).text();
  // Must match LOCKED_CONTENT_RE in src/services/extractor.ts.
  expect(html).toMatch(/nội dung chương.{0,20}bị khóa/i);
  // renderer.ts rejects HTML shorter than 1500 chars before extraction runs,
  // which would bypass the locked-content check and burn the retry budget.
  expect(html.length).toBeGreaterThan(1500);
});

test("serves PNG and MP3 assets with the right magic bytes", async ({ request }) => {
  for (const path of ["/cover/fixture-a.png", "/media/pixel.png"]) {
    const res = await request.get(`${FIXTURE_URL}${path}`);
    expect(res.status()).toBe(200);
    const bytes = await res.body();
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  const mp3 = await request.get(`${FIXTURE_URL}/media/tone.mp3`);
  expect(mp3.status()).toBe(200);
  expect((await mp3.body()).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfb]));
});
