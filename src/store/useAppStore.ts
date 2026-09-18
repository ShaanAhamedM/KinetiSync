import { create } from 'zustand';
import type { MotionPathProfile, MotionFrame } from '../types/MotionPath';
import type { DtwWorkerOutput } from '../utils/dtwWorker';

export type AppState = 'LANDING' | 'SESSION' | 'REPLAY' | 'VIDEO_PROCESS';

export interface AttemptRecord {
  id: string;
  expertProfileId: string;
  timestamp: number;
  duration: number;
  frames: MotionFrame[];
  scores: { timestamp: number; score: DtwWorkerOutput }[]; // Timeline of scores
}

interface AppStore {
  appState: AppState;
  setAppState: (state: AppState) => void;
  
  // Expert Profile
  activeProfile: MotionPathProfile | null;
  setActiveProfile: (profile: MotionPathProfile | null) => void;
  
  // Video Upload
  uploadedVideoUrl: string | null;
  setUploadedVideoUrl: (url: string | null) => void;
  
  // Trainee Attempts
  activeAttempt: AttemptRecord | null;
  setActiveAttempt: (attempt: AttemptRecord | null) => void;
  attemptsHistory: AttemptRecord[];
  addAttempt: (attempt: AttemptRecord) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  appState: 'LANDING',
  setAppState: (state) => set({ appState: state }),
  
  activeProfile: null,
  setActiveProfile: (profile) => set({ activeProfile: profile }),
  
  uploadedVideoUrl: null,
  setUploadedVideoUrl: (url) => set({ uploadedVideoUrl: url }),
  
  activeAttempt: null,
  setActiveAttempt: (attempt) => set({ activeAttempt: attempt }),
  
  attemptsHistory: [],
  addAttempt: (attempt) => set((state) => ({ attemptsHistory: [...state.attemptsHistory, attempt] })),
}));
