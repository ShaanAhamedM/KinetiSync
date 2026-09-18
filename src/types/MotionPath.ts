import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export interface MotionFrame {
  timestamp: number; // Offset from start in ms
  landmarks: NormalizedLandmark[][]; // Array of detected hands, each hand is an array of 21 landmarks
  poseLandmarks?: NormalizedLandmark[][]; // Array of detected poses, each pose is an array of 33 landmarks
}

export interface MotionPathProfile {
  id: string;
  name: string;
  duration: number; // total duration in ms
  createdAt: number;
  frames: MotionFrame[];
}
