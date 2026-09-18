import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/**
 * Calculates the Euclidean distance between two 3D points.
 */
export const calculateEuclideanDistance = (p1: NormalizedLandmark, p2: NormalizedLandmark): number => {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  const dz = (p1.z || 0) - (p2.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/**
 * Normalizes a hand's landmarks relative to the wrist (landmark 0) 
 * and scales them by the distance from the wrist to the middle finger MCP (landmark 9).
 * This ensures the deviation engine measures motion shape, not raw screen position or camera distance.
 */
export const normalizeHand = (landmarks: NormalizedLandmark[]): NormalizedLandmark[] => {
  if (!landmarks || landmarks.length !== 21) return landmarks;
  
  const wrist = landmarks[0];
  const mcp = landmarks[9];
  
  // Calculate hand scale. If 0 (extremely unlikely), default to 1 to prevent division by zero.
  const scale = calculateEuclideanDistance(wrist, mcp) || 1; 

  return landmarks.map(lm => ({
    x: (lm.x - wrist.x) / scale,
    y: (lm.y - wrist.y) / scale,
    z: ((lm.z || 0) - (wrist.z || 0)) / scale,
    visibility: lm.visibility,
  }));
};
