import fs from "fs/promises";
import { StoredStory } from "../../types";
import { Library } from "../../routes/library";
import { estimateRemainingMs } from "../crawl";
import { t } from "../lang";
import { compilationLabel, compilationPlaylistTitle, resolveCompilationPath } from "../youtube/compilation";
import { resolveVideoPath, YouTubeEvent } from "../youtube/jobs";
import { videoTitle } from "../youtube/meta";
import { FacebookAccount } from "./account";
import { fetchVideoLink, isRateLimit, uploadVideo, usableSchedule } from "./api";
import { prepareForFacebook } from "./normalize";
import { FacebookCompilationRecord, FacebookVideoRecord } from "./types";

export interface FacebookUploadInput {
  library: Library;
  story: StoredStory;
  orders: number[];
  account: FacebookAccount;
  channel: string;
  signal: AbortSignal;
  onEvent: (event: YouTubeEvent) => void;
}

/**
 * Posts the chapter videos the YouTube "render" step wrote to the person's Facebook Page.
 * A chapter without a publish time goes public right away; one with a time Facebook accepts
 * (10 minutes to 30 days ahead) is scheduled; one with a time it cannot take stays
 * unpublished, so it never goes public earlier than asked. A chapter already posted is
 * left alone.
 */
export async function uploadFacebookVideos(
  input: FacebookUploadInput
): Promise<{ done: number; failed: number; message?: string }> {
  const { library, story, account, signal, onEvent } = input;
  const total = input.orders.length;
  const startedAt = Date.now();
  let done = 0;
  let failed = 0;
  let unscheduled = 0;

  const save = (order: number, patch: Partial<FacebookVideoRecord>, current?: FacebookVideoRecord) =>
    library.stories.saveFacebookVideo({
      createdAt: current?.createdAt ?? new Date().toISOString(),
      ...current,
      ...patch,
      order,
      status: patch.status ?? current?.status ?? "error",
      storyId: story.id,
      updatedAt: new Date().toISOString(),
    });
  const fail = async (order: number, message: string, current?: FacebookVideoRecord) => {
    await save(order, { status: "error", error: message }, current);
    failed++;
    onEvent({ type: "youtube-chapter-done", phase: "facebook", order, state: "error", message, done, total });
  };

  for (const order of input.orders) {
    if (signal.aborted) break;
    const youtube = await library.stories.getYouTubeVideo(story.id, order);
    const existing = await library.stories.getFacebookVideo(story.id, order);
    if (existing?.status === "uploaded") {
      done++;
      continue;
    }
    const file = youtube ? resolveVideoPath(library.dataDir, story.id, youtube) : undefined;
    if (!file || !(await fs.stat(file).catch(() => undefined))) {
      await fail(order, t("Chapter {order} has no video yet — make the videos first", { order }), existing);
      continue;
    }

    try {
      await save(order, { status: "uploading", error: undefined }, existing);
      const scheduled = usableSchedule(youtube!.publishAt);
      if (youtube!.publishAt && !scheduled) unscheduled++;
      const progress = (order: number, percent: number) =>
        onEvent({ type: "youtube-progress", phase: "facebook", order, done, total, percent: Math.round(percent) });
      // Facebook wants its own encoding (see normalize.ts): a copy is made when the file lacks it.
      const prepared = await prepareForFacebook({ file, signal, onProgress: (fraction) => progress(order, fraction * 50) });
      let uploaded;
      try {
        uploaded = await uploadVideo(
          account.token,
          {
            pageId: account.pageId,
            filePath: prepared.path,
            title: youtube!.title ?? videoTitle(story.title, order, input.channel),
            description: youtube!.description ?? "",
            scheduledPublishTime: scheduled,
            publishNow: !youtube!.publishAt,
          },
          (sent, size) => {
            const fraction = size > 0 ? sent / size : 0;
            progress(order, prepared.converted ? 50 + fraction * 50 : fraction * 100);
          },
          signal
        );
      } finally {
        await prepared.cleanup();
      }
      await save(
        order,
        {
          status: "uploaded",
          videoId: uploaded.id,
          videoUrl: await fetchVideoLink(account.pageId, uploaded.id, account.token),
          scheduledAt: scheduled ? new Date(scheduled * 1000).toISOString() : undefined,
          error: undefined,
        },
        existing
      );
      done++;
      onEvent({
        type: "youtube-chapter-done",
        phase: "facebook",
        order,
        state: "done",
        done,
        total,
        etaMs: estimateRemainingMs({ startedAt, completed: done, total }),
      });
    } catch (err) {
      if (signal.aborted) break;
      await fail(order, err instanceof Error ? err.message : String(err), existing);
      if (isRateLimit(err)) {
        return { done, failed, message: t("Facebook's limit is reached. Try again in a while.") };
      }
    }
  }
  const message = unscheduled
    ? t("{count} video(s) were left unpublished: Facebook only schedules 10 minutes to 30 days ahead", { count: unscheduled })
    : undefined;
  return { done, failed, message };
}

// Facebook's own limits for a Page video: 4 hours and 10 GB. Facebook compilation parts are
// cut to fit, so this only catches a single chapter longer than that, before uploading.
export const FACEBOOK_MAX_SECONDS = 4 * 3600;
export const FACEBOOK_MAX_BYTES = 10 * 1024 ** 3;

export interface FacebookCompilationUploadInput extends Omit<FacebookUploadInput, "orders"> {
  // Compilation part ids; absent = every part that has a rendered video and is not posted.
  ids?: string[];
}

/**
 * Posts a story's compilation parts (several chapters joined into one video) to the Page,
 * with the title and description made for YouTube. Same rules as the chapter videos:
 * public right away without a publish time, scheduled with one, and a part already posted is skipped.
 */
export async function uploadFacebookCompilations(
  input: FacebookCompilationUploadInput
): Promise<{ done: number; failed: number; message?: string }> {
  const { library, story, account, signal, onEvent } = input;
  const channelTitle = compilationPlaylistTitle(story.title, input.channel);
  const parts = (await library.stories.listCompilations(story.id, "facebook")).filter(
    (part) => (!input.ids || input.ids.includes(part.id)) && part.videoPath && part.status !== "rendering"
  );
  const total = parts.length;
  const startedAt = Date.now();
  let done = 0;
  let failed = 0;
  let unscheduled = 0;

  const save = async (id: string, patch: Partial<FacebookCompilationRecord>, current?: FacebookCompilationRecord) =>
    library.stories.saveFacebookCompilation({
      createdAt: current?.createdAt ?? new Date().toISOString(),
      ...current,
      ...patch,
      id,
      status: patch.status ?? current?.status ?? "error",
      storyId: story.id,
      updatedAt: new Date().toISOString(),
    });

  for (const part of parts) {
    if (signal.aborted) break;
    const existing = await library.stories.getFacebookCompilation(story.id, part.id);
    if (existing?.status === "uploaded") {
      done++;
      continue;
    }
    const fail = async (message: string) => {
      await save(part.id, { status: "error", error: message }, existing);
      failed++;
      onEvent({ type: "youtube-chapter-done", phase: "facebook", order: part.part, state: "error", message, done, total });
    };
    const file = resolveCompilationPath(library.dataDir, story.id, part);
    const stat = file ? await fs.stat(file).catch(() => undefined) : undefined;
    if (!file || !stat) {
      await fail(t("The video file for chapter {order} is missing — make the videos again", { order: part.fromOrder }));
      continue;
    }
    if ((part.videoSeconds ?? 0) > FACEBOOK_MAX_SECONDS || stat.size > FACEBOOK_MAX_BYTES) {
      await fail(t("Facebook takes videos up to 4 hours and 10 GB — {label} is longer. Make the parts shorter.", { label: part.label }));
      continue;
    }

    try {
      await save(part.id, { status: "uploading", error: undefined }, existing);
      const scheduled = usableSchedule(part.publishAt);
      if (part.publishAt && !scheduled) unscheduled++;
      const progress = (percent: number) =>
        onEvent({ type: "youtube-progress", phase: "facebook", order: part.part, done, total, percent: Math.round(percent) });
      // Facebook wants its own encoding (see normalize.ts): a copy is made when the file lacks it.
      const prepared = await prepareForFacebook({ file, signal, onProgress: (fraction) => progress(fraction * 50) });
      let uploaded;
      try {
        uploaded = await uploadVideo(
          account.token,
          {
            pageId: account.pageId,
            filePath: prepared.path,
            title: part.title ?? compilationLabel(channelTitle, part.part, part.parts, part.fromOrder, part.toOrder),
            description: part.description ?? "",
            scheduledPublishTime: scheduled,
            publishNow: !part.publishAt,
          },
          (sent, size) => {
            const fraction = size > 0 ? sent / size : 0;
            progress(prepared.converted ? 50 + fraction * 50 : fraction * 100);
          },
          signal
        );
      } finally {
        await prepared.cleanup();
      }
      await save(
        part.id,
        {
          status: "uploaded",
          videoId: uploaded.id,
          videoUrl: await fetchVideoLink(account.pageId, uploaded.id, account.token),
          scheduledAt: scheduled ? new Date(scheduled * 1000).toISOString() : undefined,
          error: undefined,
        },
        existing
      );
      done++;
      onEvent({
        type: "youtube-chapter-done",
        phase: "facebook",
        order: part.part,
        state: "done",
        done,
        total,
        etaMs: estimateRemainingMs({ startedAt, completed: done, total }),
      });
    } catch (err) {
      if (signal.aborted) break;
      await fail(err instanceof Error ? err.message : String(err));
      if (isRateLimit(err)) {
        return { done, failed, message: t("Facebook's limit is reached. Try again in a while.") };
      }
    }
  }
  const message = unscheduled
    ? t("{count} video(s) were left unpublished: Facebook only schedules 10 minutes to 30 days ahead", { count: unscheduled })
    : undefined;
  return { done, failed, message };
}

/**
 * Chapters whose rendered video is on this computer and not on the Page yet. A chapter the
 * YouTube sync marked as uploaded (made by the upload script) has no file here, so it is
 * not offered: there would be nothing to send.
 */
export async function readyFacebookOrders(library: Library, storyId: string): Promise<number[]> {
  const posted = new Set(
    (await library.stories.listFacebookVideos(storyId)).filter((v) => v.status === "uploaded").map((v) => v.order)
  );
  return (await library.stories.listYouTubeVideos(storyId))
    .filter(
      (v) =>
        v.videoPath &&
        (v.status === "rendered" || v.status === "uploaded" || v.status === "error") &&
        !posted.has(v.order)
    )
    .map((v) => v.order);
}

/** Facebook compilation parts (cut to 4 h) with a rendered video that is not on the Page yet. */
export async function readyFacebookCompilations(
  library: Library,
  storyId: string
): Promise<{ id: string; label: string }[]> {
  const posted = new Set(
    (await library.stories.listFacebookCompilations(storyId)).filter((v) => v.status === "uploaded").map((v) => v.id)
  );
  return (await library.stories.listCompilations(storyId, "facebook"))
    .filter((part) => part.videoPath && part.status !== "rendering" && !posted.has(part.id))
    .map((part) => ({ id: part.id, label: part.label }));
}
