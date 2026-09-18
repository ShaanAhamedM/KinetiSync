import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { calculateEuclideanDistance } from './deviationEngine';

// Define the shape of messages sent to the worker
export interface DtwWorkerInput {
  liveWindow: NormalizedLandmark[][]; // N recent frames of a single hand
  ghostWindow: NormalizedLandmark[][]; // M recent frames of the expert hand
}

// Define the shape of messages returned by the worker
export interface DtwWorkerOutput {
  overallScore: number;
  fingerScores: {
    thumb: number;
    index: number;
    middle: number;
    ring: number;
    pinky: number;
  };
}

const FINGER_INDICES = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

// Computes distance between two normalized hand frames
const computeFrameDistance = (frame1: NormalizedLandmark[], frame2: NormalizedLandmark[], indices: number[] = Array.from({length: 21}, (_, i) => i)) => {
  let totalDist = 0;
  for (const i of indices) {
    totalDist += calculateEuclideanDistance(frame1[i], frame2[i]);
  }
  return totalDist / indices.length;
};

// Fast DTW implementation for two sequences of frames
const computeDTW = (seq1: NormalizedLandmark[][], seq2: NormalizedLandmark[][], indices: number[]): number => {
  if (seq1.length === 0 || seq2.length === 0) return 0;
  const n = seq1.length;
  const m = seq2.length;
  const dtw = Array(n + 1).fill(null).map(() => Array(m + 1).fill(Infinity));
  dtw[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = computeFrameDistance(seq1[i - 1], seq2[j - 1], indices);
      dtw[i][j] = cost + Math.min(
        dtw[i - 1][j],    // insertion
        dtw[i][j - 1],    // deletion
        dtw[i - 1][j - 1] // match
      );
    }
  }
  return dtw[n][m] / Math.max(n, m); // Normalize by sequence length
};

// Convert DTW distance (which represents error) to a 0-100 Match Score
// Normalization makes distances small. A distance of 0.2 means significant deviation.
const scoreFromDistance = (distance: number): number => {
  const MAX_ACCEPTABLE_DISTANCE = 0.5; // Tuned for normalized coordinates
  const score = 100 - ((distance / MAX_ACCEPTABLE_DISTANCE) * 100);
  return Math.max(0, Math.min(100, Math.round(score)));
};

self.onmessage = (e: MessageEvent<DtwWorkerInput>) => {
  const { liveWindow, ghostWindow } = e.data;
  
  if (!liveWindow.length || !ghostWindow.length) {
    self.postMessage({ overallScore: 0, fingerScores: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 } });
    return;
  }

  // Calculate overall DTW
  const allIndices = Array.from({length: 21}, (_, i) => i);
  const overallDist = computeDTW(liveWindow, ghostWindow, allIndices);
  
  // Calculate per-finger DTW
  const thumbDist = computeDTW(liveWindow, ghostWindow, FINGER_INDICES.thumb);
  const indexDist = computeDTW(liveWindow, ghostWindow, FINGER_INDICES.index);
  const middleDist = computeDTW(liveWindow, ghostWindow, FINGER_INDICES.middle);
  const ringDist = computeDTW(liveWindow, ghostWindow, FINGER_INDICES.ring);
  const pinkyDist = computeDTW(liveWindow, ghostWindow, FINGER_INDICES.pinky);

  const output: DtwWorkerOutput = {
    overallScore: scoreFromDistance(overallDist),
    fingerScores: {
      thumb: scoreFromDistance(thumbDist),
      index: scoreFromDistance(indexDist),
      middle: scoreFromDistance(middleDist),
      ring: scoreFromDistance(ringDist),
      pinky: scoreFromDistance(pinkyDist),
    }
  };

  self.postMessage(output);
};
