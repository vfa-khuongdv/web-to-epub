import { vi } from "vitest";
import type { NarrationPlayer } from "../hooks/narrationPlayer";

// A NarrationPlayer with a chapter loaded and every action a spy.
export function fakePlayer(over: Partial<NarrationPlayer> = {}): NarrationPlayer {
  return {
    storyId: "s1",
    storyTitle: "My Story",
    coverUrl: null,
    order: 2,
    playing: false,
    time: 65,
    duration: 130,
    rate: 1,
    volume: 0.8,
    error: null,
    hasNext: true,
    hasPrevious: true,
    upNext: [2, 3],
    titleOf: (o: number) => (o === 2 ? "Noon" : o === 3 ? "" : ""),
    isPlaying: () => false,
    play: vi.fn(),
    updateQueue: vi.fn(),
    jumpTo: vi.fn(),
    toggle: vi.fn(),
    seek: vi.fn(),
    skip: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    setRate: vi.fn(),
    setVolume: vi.fn(),
    musicEnabled: false,
    musicTrack: null,
    musicVolume: 0.3,
    setMusicEnabled: vi.fn(),
    setMusicTrack: vi.fn(),
    setMusicVolume: vi.fn(),
    close: vi.fn(),
    openRequest: null,
    requestOpen: vi.fn(),
    clearOpenRequest: vi.fn(),
    ...over,
  };
}
