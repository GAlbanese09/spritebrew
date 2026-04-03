import { create } from 'zustand';
import type { SpriteSheet, SpriteAnimation } from '@/lib/types';

interface SpriteStore {
  spriteSheet: SpriteSheet | null;
  selectedFrames: string[];
  animations: SpriteAnimation[];
  frameDataUrls: Map<string, string>;

  setSpriteSheet: (sheet: SpriteSheet) => void;
  clearSpriteSheet: () => void;
  setFrameDataUrls: (urls: Map<string, string>) => void;
  updateFrameOrder: (animationId: string, frameIds: string[]) => void;
  addAnimation: (animation: SpriteAnimation) => void;
  removeAnimation: (animationId: string) => void;
  assignFramesToAnimation: (animationId: string, frameIds: string[]) => void;
  updateAnimationFps: (animationId: string, fps: number) => void;
  setSelectedFrames: (frameIds: string[]) => void;
  toggleFrameSelection: (frameId: string) => void;
}

export const useSpriteStore = create<SpriteStore>((set) => ({
  spriteSheet: null,
  selectedFrames: [],
  animations: [],
  frameDataUrls: new Map(),

  setSpriteSheet: (sheet) =>
    set({ spriteSheet: sheet, selectedFrames: [], animations: [] }),

  clearSpriteSheet: () =>
    set({ spriteSheet: null, selectedFrames: [], animations: [], frameDataUrls: new Map() }),

  setFrameDataUrls: (urls) => set({ frameDataUrls: urls }),

  updateFrameOrder: (animationId, frameIds) =>
    set((state) => {
      if (!state.spriteSheet) return state;
      const allFrames = state.spriteSheet.animations.flatMap((a) => a.frames);
      return {
        animations: state.animations.map((a) => {
          if (a.id !== animationId) return a;
          const reordered = frameIds
            .map((id) => a.frames.find((f) => f.id === id) ?? allFrames.find((f) => f.id === id))
            .filter(Boolean) as typeof a.frames;
          return { ...a, frames: reordered };
        }),
      };
    }),

  addAnimation: (animation) =>
    set((state) => ({ animations: [...state.animations, animation] })),

  removeAnimation: (animationId) =>
    set((state) => ({
      animations: state.animations.filter((a) => a.id !== animationId),
    })),

  assignFramesToAnimation: (animationId, frameIds) =>
    set((state) => {
      if (!state.spriteSheet) return state;
      const allFrames = state.spriteSheet.animations.flatMap((a) => a.frames);
      const framesToAssign = frameIds
        .map((id) => allFrames.find((f) => f.id === id))
        .filter(Boolean) as typeof allFrames;

      return {
        animations: state.animations.map((a) => {
          if (a.id !== animationId) return a;
          // Append new frames, avoid duplicates
          const existingIds = new Set(a.frames.map((f) => f.id));
          const newFrames = framesToAssign.filter((f) => !existingIds.has(f.id));
          return { ...a, frames: [...a.frames, ...newFrames] };
        }),
        selectedFrames: [],
      };
    }),

  updateAnimationFps: (animationId, fps) =>
    set((state) => ({
      animations: state.animations.map((a) =>
        a.id === animationId ? { ...a, fps } : a
      ),
    })),

  setSelectedFrames: (frameIds) => set({ selectedFrames: frameIds }),

  toggleFrameSelection: (frameId) =>
    set((state) => {
      const exists = state.selectedFrames.includes(frameId);
      return {
        selectedFrames: exists
          ? state.selectedFrames.filter((id) => id !== frameId)
          : [...state.selectedFrames, frameId],
      };
    }),
}));
