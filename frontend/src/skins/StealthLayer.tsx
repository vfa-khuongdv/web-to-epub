import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNarrationPlayer } from "../hooks/narrationPlayer";
import { DocumentHead, REAL_HEAD, applyHead, writeHeadCache } from "../lib/ui/skin";
import {
  STEALTH_HIDE_EVENT,
  STEALTH_TOGGLE_EVENT,
  blurIsOwnDialog,
  isBossKey,
  isTextEntry,
} from "../lib/ui/stealth";
import { useVault } from "../vault";
import { useSkin } from "./SkinProvider";
import { SkinDefinition } from "./types";

// Everything playing falls silent: the narration player (its <audio> is not in the DOM),
// and any media element in the page or in a same-origin frame such as the reader.
function pauseMedia(doc: Document) {
  doc.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => media.pause());
  doc.querySelectorAll("iframe").forEach((frame) => {
    try {
      if (frame.contentDocument) pauseMedia(frame.contentDocument);
    } catch {
      /* a cross-origin frame plays nothing of ours */
    }
  });
}

/**
 * The boss key and everything that follows from it. One instance, inside App (it needs
 * the narration player), in every skin, the default one included. Whether the decoy is up
 * lives in SkinProvider, above the private-mode remount.
 *
 * Hiding swaps the whole screen for the skin's decoy — fake work with no story in it —
 * rendered outside #root, which is made inert so no dialog, toast or focused control
 * underneath can be reached or announced. Full screen is left, everything audible is
 * paused, and every key but the boss key is swallowed, so a stray Space cannot start the
 * narration again behind the decoy. Nothing resumes on its own when the decoy goes.
 *
 * The tab title and favicon follow the skin (and the decoy while it shows); the last
 * skin head is cached so index.html can show it before the app has even loaded.
 */
export default function StealthLayer({ definition, head }: { definition: SkinDefinition; head: DocumentHead | null }) {
  const { skin, prefs, hidden, setHidden } = useSkin();
  const isPrivate = useVault().active;
  const player = useNarrationPlayer();
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const decoyRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const lastGesture = useRef(0);
  // Set while hide-on-blur is on; frames call it too (see attachFrame).
  const onBlurRef = useRef<(() => void) | null>(null);
  const pause = useRef(player.pause);
  pause.current = player.pause;

  const silence = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    pause.current();
    pauseMedia(document);
    window.dispatchEvent(new Event(STEALTH_HIDE_EVENT));
  }, []);

  const hide = useCallback(() => {
    if (hiddenRef.current) return;
    hiddenRef.current = true;
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    silence();
    setHidden(true);
  }, [setHidden, silence]);

  const reveal = useCallback(() => {
    if (!hiddenRef.current) return;
    hiddenRef.current = false;
    setHidden(false);
  }, [setHidden]);

  const toggle = useCallback(() => (hiddenRef.current ? reveal() : hide()), [hide, reveal]);

  // Mounted while the decoy is already up (App remounts on a library switch): the new
  // tree's player and media start silent anyway, but make sure.
  useEffect(() => {
    if (hiddenRef.current) silence();
  }, [silence]);

  // The page under the decoy can be neither reached nor read while it shows.
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    if (hidden) {
      root.setAttribute("inert", "");
      root.setAttribute("aria-hidden", "true");
      decoyRef.current?.focus({ preventScroll: true });
    } else {
      root.removeAttribute("inert");
      root.removeAttribute("aria-hidden");
      restoreFocus.current?.focus({ preventScroll: true });
      restoreFocus.current = null;
    }
  }, [hidden]);

  useEffect(
    () => () => {
      const root = document.getElementById("root");
      root?.removeAttribute("inert");
      root?.removeAttribute("aria-hidden");
    },
    []
  );

  // Keys: on the window in the capture phase, ahead of every other handler in the app,
  // and on each same-origin frame's document (the reader's chapter frame keeps focus while
  // reading, and its key events never reach this window). Frames are re-attached on every
  // load, since the reader replaces its document on each chapter and preference change.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.type === "keydown" && (event.key === "Enter" || event.key === " ")) lastGesture.current = Date.now();
      if (hiddenRef.current) {
        // A held key repeats: it must not reveal the screen right after hiding it.
        if (event.type === "keydown" && !event.repeat && isBossKey(event, false)) {
          event.preventDefault();
          reveal();
        } else if (!event.ctrlKey && !event.metaKey) {
          event.preventDefault();
        }
        // Browser shortcuts (Cmd/Ctrl+…) still work; the app's own never see the key.
        event.stopPropagation();
        return;
      }
      if (event.type !== "keydown" || !isBossKey(event, isTextEntry(event.target))) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) hide();
    };
    const onFrameBlur = () => onBlurRef.current?.();

    // Frames' documents and windows with a listener. A replaced document (each new
    // chapter) loses its window; it is dropped here rather than kept for the session.
    let attached: { doc: Document; win: Window }[] = [];
    const attachFrame = (frame: HTMLIFrameElement) => {
      try {
        const doc = frame.contentDocument;
        const win = frame.contentWindow;
        attached = attached.filter((entry) => entry.doc.defaultView);
        if (!doc || !win || attached.some((entry) => entry.doc === doc)) return;
        doc.addEventListener("keydown", onKey, true);
        // Alt-tab while focus is in the frame blurs the frame's window, not this one.
        win.addEventListener("blur", onFrameBlur);
        attached.push({ doc, win });
      } catch {
        /* cross-origin: none of ours */
      }
    };
    const onLoad = (event: Event) => {
      if (event.target instanceof HTMLIFrameElement) attachFrame(event.target);
    };

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    document.addEventListener("load", onLoad, true);
    document.querySelectorAll("iframe").forEach(attachFrame);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      document.removeEventListener("load", onLoad, true);
      for (const { doc, win } of attached) {
        doc.removeEventListener("keydown", onKey, true);
        win.removeEventListener("blur", onFrameBlur);
      }
    };
  }, [hide, reveal]);

  // Anything in the app can ask (the command palette's "Hide now").
  useEffect(() => {
    window.addEventListener(STEALTH_TOGGLE_EVENT, toggle);
    return () => window.removeEventListener(STEALTH_TOGGLE_EVENT, toggle);
  }, [toggle]);

  // Hide when the user leaves: another app takes focus, or another browser tab is shown.
  // A blur right after a click or key press in this page is the app opening something of
  // its own (a file picker, the export folder dialog, a link in the browser) — not leaving.
  // Focus moving between this page and the reader's frame blurs one window while the
  // document still has focus, hence the check once the blur has settled.
  useEffect(() => {
    if (!prefs.hideOnBlur) return;
    const onGesture = () => {
      lastGesture.current = Date.now();
    };
    const onBlur = () => {
      if (blurIsOwnDialog(lastGesture.current, Date.now())) return;
      setTimeout(() => {
        if (!document.hasFocus()) hide();
      }, 0);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hide();
    };
    onBlurRef.current = onBlur;
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      onBlurRef.current = null;
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [prefs.hideOnBlur, hide]);

  // Desktop app: the system-wide boss key, registered only while this option is on. From
  // another app it only ever hides — the decoy may already be up (hide-on-blur), and
  // pressing the key from elsewhere must not uncover the story on a screen nobody watches.
  useEffect(() => {
    const bridge = window.electronStealth;
    if (!bridge || !prefs.globalKey) return;
    bridge.setGlobalKey(true);
    const off = bridge.onBossKey(() => (document.hasFocus() ? toggle() : hide()));
    return () => {
      off();
      bridge.setGlobalKey(false);
    };
  }, [prefs.globalKey, toggle, hide]);

  // The tab: the decoy's while hidden, the skin's otherwise, the app's own with no skin.
  const skinHead = skin === "default" ? null : (head ?? definition.head);
  const shown = hidden ? definition.decoy.head : (skinHead ?? REAL_HEAD);
  useEffect(() => {
    applyHead(shown);
  }, [shown.title, shown.favicon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cached for the next launch's first paint. A private-library file name never is: the
  // cache outlives the private session, and the next launch starts in the public library.
  const cached = skinHead && isPrivate ? definition.head : skinHead;
  useEffect(() => {
    writeHeadCache(cached);
  }, [cached?.title, cached?.favicon]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hidden) return null;
  const Decoy = definition.decoy.Component;
  return createPortal(
    <div ref={decoyRef} tabIndex={-1} className="fixed inset-0 z-[1000] outline-none" data-stealth-decoy="">
      <Decoy />
    </div>,
    document.body
  );
}
