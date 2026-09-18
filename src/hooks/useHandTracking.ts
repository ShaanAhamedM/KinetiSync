import { useEffect, useRef, useState } from 'react';
import { HandLandmarker, PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { HandLandmarkerResult, PoseLandmarkerResult } from '@mediapipe/tasks-vision';

export interface BiomechanicalResult {
  hands: HandLandmarkerResult | null;
  pose: PoseLandmarkerResult | null;
}

export const useHandTracking = (videoElement: HTMLVideoElement | null) => {
  const [handLandmarker, setHandLandmarker] = useState<HandLandmarker | null>(null);
  const [poseLandmarker, setPoseLandmarker] = useState<PoseLandmarker | null>(null);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const requestRef = useRef<number | undefined>(undefined);
  const lastVideoTimeRef = useRef(-1);
  const onResultsRef = useRef<((result: BiomechanicalResult) => void) | undefined>(undefined);

  useEffect(() => {
    let active = true;
    const loadModel = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        const poseModel = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        if (active) {
          setHandLandmarker(landmarker);
          setPoseLandmarker(poseModel);
          setIsModelLoaded(true);
        }
      } catch (error) {
        console.error("Error loading MediaPipe models:", error);
      }
    };
    loadModel();

    return () => {
      active = false;
      // We don't eagerly close it here to avoid issues with hot reloading,
      // but in production we might want to call landmarker.close() when component unmounts.
    };
  }, []);

  const setOnResults = (callback: (result: BiomechanicalResult) => void) => {
    onResultsRef.current = callback;
  };

  useEffect(() => {
    if (!handLandmarker || !poseLandmarker || !videoElement) return;

    const detect = () => {
      if (videoElement.readyState >= 2) {
        let startTimeMs = performance.now();
        if (lastVideoTimeRef.current !== videoElement.currentTime) {
          lastVideoTimeRef.current = videoElement.currentTime;
          
          const hands = handLandmarker.detectForVideo(videoElement, startTimeMs);
          const pose = poseLandmarker.detectForVideo(videoElement, startTimeMs);
          
          if (onResultsRef.current) {
            onResultsRef.current({ hands, pose });
          }
        }
      }
      requestRef.current = requestAnimationFrame(detect);
    };

    requestRef.current = requestAnimationFrame(detect);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [handLandmarker, poseLandmarker, videoElement]);

  return { isModelLoaded, setOnResults };
};
