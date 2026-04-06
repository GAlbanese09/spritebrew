import { create } from 'zustand';
import type { SpriteSheet, SpriteAnimation, SpriteFrame } from '@/lib/types';

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
  /** The action label being generated (e.g., "attack", "walk"). Set before the
   *  API call so the loading indicator can show "Brewing your attack animation..." */
  generatingAction: string | null;
  originalCharacterDataUrl: string | null;
  generationCount: number;
  generationCountDate: string;

  setSpriteSheet: (sheet: SpriteSheet) => void;
  clearSpriteSheet: () => void;
  setFrameDataUrls: (urls: Map<string, string>) => void;
  updateFrameOrder: (animationId: string, frames: SpriteFrame[]) => void;
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
  setGeneratingAction: (action: string | null) => void;
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
  generatingAction: null,
  originalCharacterDataUrl: null,
  generationCount: 0,
  generationCountDate: '',

  setSpriteSheet: (sheet) =>
    set({ spriteSheet: sheet, selectedFrames: [], animations: [] }),

  clearSpriteSheet: () =>
    set({ spriteSheet: null, selectedFrames: [], animations: [], frameDataUrls: new Map(), generationStyle: null }),

  setFrameDataUrls: (urls) => set({ frameDataUrls: urls }),

  // Accepts the full frame array directly — supports duplicate frames in the
  // sequence since ID-based resolution is ambiguous when duplicates exist.
  updateFrameOrder: (animationId, frames) =>
    set((state) => ({
      animations: state.animations.map((a) =>
        a.id === animationId ? { ...a, frames } : a
      ),
    })),

  addAnimation: (animation) =>
    set((state) => ({ animations: [...state.animations, animation] })),

  removeAnimation: (animationId) =>
    set((state) => ({
      animations: state.animations.filter((a) => a.id !== animationId),
    })),

  // Duplicates allowed: the same frame can appear multiple times in a group
  // to create balanced animations (e.g., ping-pong walk cycles like [0,1,2,3,2,1]).
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
          return { ...a, frames: [...a.frames, ...framesToAssign] };
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

  setGenerating: (loading) => {
    console.log('[STORE] setGenerating called with:', loading, new Error().stack?.split('\n')[2]);
    set({ isGenerating: loading });
  },

  // Only force isGenerating=false when setting an ACTUAL error. Calling
  // setGenerationError(null) to clear the field should NOT touch isGenerating —
  // otherwise clearing the error right after setGenerating(true) would
  // immediately reset the loading state (the old bug).
  setGenerationError: (error) => {
    if (error) {
      set({ generationError: error, isGenerating: false });
    } else {
      set({ generationError: null });
    }
  },

  setGenerationStyle: (style) => set({ generationStyle: style }),

  setAnimateMode: (mode) => set({ animateMode: mode }),

  setOriginalCharacter: (dataUrl) => set({ originalCharacterDataUrl: dataUrl }),

  setGenerationCount: (count, date) => set({ generationCount: count, generationCountDate: date }),

  setGeneratingAction: (action) => set({ generatingAction: action }),
}));
