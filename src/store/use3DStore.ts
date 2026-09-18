import { create } from 'zustand';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { DtwWorkerOutput } from '../utils/dtwWorker';

interface ThreeDState {
  liveLandmarks: NormalizedLandmark[][] | null;
  ghostLandmarks: NormalizedLandmark[][] | null;
  dtwScores: DtwWorkerOutput | null;
  aspectRatio: number;
  setFrameData: (live: NormalizedLandmark[][] | null, ghost: NormalizedLandmark[][] | null, scores: DtwWorkerOutput | null, aspectRatio?: number) => void;
}

export const use3DStore = create<ThreeDState>((set) => ({
  liveLandmarks: null,
  ghostLandmarks: null,
  dtwScores: null,
  aspectRatio: 1,
  setFrameData: (live, ghost, scores, aspectRatio = 1) => set({ liveLandmarks: live, ghostLandmarks: ghost, dtwScores: scores, aspectRatio })
}));
