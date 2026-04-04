import { create } from 'zustand';
import type { SpriteSheet, SpriteAnimation } from '@/lib/types';

interface SpriteStore {
  spriteSheet: SpriteSheet | null;
  selectedFrames: string[];
  animations: SpriteAnimation[];
  frameDataUrls: Map<string, string>;

  // Generation state
  generatedImageUrl: string | null;
  generatedImageDataUrl: string | null;
  isGenerating: boolean;
  generationError: string | null;
  generationStyle: string | null;
  animateMode: 'create' | 'animate';
  originalCharacterDataUrl: string | null;
  generationCount: number; // today's count (mirrored from localStorage for reactivity)
  generationCountDate: string; // YYYY-MM-DD of the count

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
  updateFrameData: (frameId: string, newDataUrl: string) => void;

  // Generation actions
  setGeneratedImage: (url: string, dataUrl: string) => void;
  clearGeneratedImage: () => void;
  setGenerating: (loading: boolean) => void;
  setGenerationError: (error: string | null) => void;
  setGenerationStyle: (style: string | null) => void;
  setAnimateMode: (mode: 'create' | 'animate') => void;
  setOriginalCharacter: (dataUrl: string | null) => void;
  setGenerationCount: (count: number, date: string) => void;
}

export const useSpriteStore = create<SpriteStore>((set) => ({
  spriteSheet: null,
  selectedFrames: [],
  animations: [],
  frameDataUrls: new Map(),

  generatedImageUrl: null,
  generatedImageDataUrl: null,
  isGenerating: false,
  generationError: null,
  generationStyle: null,
  animateMode: 'create',
  originalCharacterDataUrl: null,
  generationCount: 0,
  generationCountDate: '',

  setSpriteSheet: (sheet) =>
    set({ spriteSheet: sheet, selectedFrames: [], animations: [] }),

  clearSpriteSheet: () =>
    set({ spriteSheet: null, selectedFrames: [], animations: [], frameDataUrls: new Map(), generationStyle: null }),

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

  updateFrameData: (frameId, newDataUrl) =>
    set((state) => {
      const urls = new Map(state.frameDataUrls);
      urls.set(frameId, newDataUrl);
      return { frameDataUrls: urls };
    }),

  setGeneratedImage: (url, dataUrl) =>
    set({ generatedImageUrl: url, generatedImageDataUrl: dataUrl, generationError: null }),

  clearGeneratedImage: () =>
    set({ generatedImageUrl: null, generatedImageDataUrl: null, originalCharacterDataUrl: null }),

  setGenerating: (loading) => set({ isGenerating: loading }),

  setGenerationError: (error) => set({ generationError: error, isGenerating: false }),

  setGenerationStyle: (style) => set({ generationStyle: style }),

  setAnimateMode: (mode) => set({ animateMode: mode }),

  setOriginalCharacter: (dataUrl) => set({ originalCharacterDataUrl: dataUrl }),

  setGenerationCount: (count, date) => set({ generationCount: count, generationCountDate: date }),
}));
