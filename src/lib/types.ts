export interface SpriteFrame {
  id: string;
  imageData: ImageData | null;
  x: number;
  y: number;
  width: number;
  height: number;
  duration: number;
}

export interface SpriteAnimation {
  id: string;
  name: string;
  type: string;
  frames: SpriteFrame[];
  fps: number;
  loop: boolean;
}

export interface SpriteSheet {
  id: string;
  name: string;
  sourceImage: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  totalFrames: number;
  animations: SpriteAnimation[];
  padding: number;
}

export interface ExportConfig {
  targetEngine: string;
  spriteSize: { width: number; height: number };
  includeMetadata: boolean;
  powerOfTwo: boolean;
  padding: number;
}

export interface DemoState {
  x: number;
  y: number;
  direction: 'left' | 'right';
  currentAnimation: string;
  isMoving: boolean;
  isRunning: boolean;
}
