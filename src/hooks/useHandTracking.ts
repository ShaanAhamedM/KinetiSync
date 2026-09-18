import { useEffect, useRef, useState, useCallback } from 'react';
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
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
        );
        
        let landmarker: HandLandmarker;
        let poseModel: PoseLandmarker;
        
        try {
          landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
              delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });

          poseModel = await PoseLandmarker.createFromOptions(vision, {
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
        } catch (e) {
          console.warn("GPU delegate failed, falling back to CPU", e);
          landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
              delegate: "CPU"
            },
            runningMode: "VIDEO",
            numHands: 1,
          });
          poseModel = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
              delegate: "CPU"
            },
            runningMode: "VIDEO",
            numPoses: 1,
          });
        }

        if (active) {
          setHandLandmarker(landmarker);
          setPoseLandmarker(poseModel);
          setIsModelLoaded(true);
        } else {
          landmarker.close();
          poseModel.close();
        }
      } catch (error) {
        console.error("Error loading MediaPipe models:", error);
      }
    };
    loadModel();

    return () => {
      active = false;
      if (handLandmarker) handLandmarker.close();
      if (poseLandmarker) poseLandmarker.close();
    };
  }, []);

  const setOnResults = useCallback((callback: (result: BiomechanicalResult) => void) => {
    onResultsRef.current = callback;
  }, []);

  useEffect(() => {
    if (!handLandmarker || !poseLandmarker || !videoElement) return;

    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }

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
        requestRef.current = undefined;
      }
    };
  }, [handLandmarker, poseLandmarker, videoElement]);

  return { isModelLoaded, setOnResults };
};
