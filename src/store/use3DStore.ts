import { create } from 'zustand';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { DtwWorkerOutput } from '../utils/dtwWorker';

export interface PhysicalFeedback {
  points: { x: number; y: number }[];
  // Per-finger observed curl angle (0-180deg) from the cardboard hand, thumb->pinky.
  angles: number[];
}

interface ThreeDState {
  liveLandmarks: NormalizedLandmark[][] | null;
  ghostLandmarks: NormalizedLandmark[][] | null;
  cardboardLandmarks: NormalizedLandmark[][] | null;
  dtwScores: DtwWorkerOutput | null;
  physicalFeedback: PhysicalFeedback | null;
  aspectRatio: number;
  cardboardAspectRatio: number;
  setFrameData: (live: NormalizedLandmark[][] | null, ghost: NormalizedLandmark[][] | null, scores: DtwWorkerOutput | null, aspectRatio?: number) => void;
  setCardboardFrameData: (landmarks: NormalizedLandmark[][] | null, aspectRatio?: number) => void;
  setPhysicalFeedback: (feedback: PhysicalFeedback | null) => void;
}

export const use3DStore = create<ThreeDState>((set) => ({
  liveLandmarks: null,
  ghostLandmarks: null,
  cardboardLandmarks: null,
  dtwScores: null,
  physicalFeedback: null,
  aspectRatio: 1,
  cardboardAspectRatio: 1,
  setFrameData: (live, ghost, scores, aspectRatio = 1) => set({ liveLandmarks: live, ghostLandmarks: ghost, dtwScores: scores, aspectRatio }),
  setCardboardFrameData: (landmarks, aspectRatio = 1) => set({ cardboardLandmarks: landmarks, cardboardAspectRatio: aspectRatio }),
  setPhysicalFeedback: (feedback) => set({ physicalFeedback: feedback })
}));
