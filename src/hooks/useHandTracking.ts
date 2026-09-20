import { useEffect, useRef, useState, useCallback } from 'react';
import { HandLandmarker, PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { HandLandmarkerResult, PoseLandmarkerResult } from '@mediapipe/tasks-vision';

export interface BiomechanicalResult {
  hands: HandLandmarkerResult | null;
  pose: PoseLandmarkerResult | null;
}

export interface HandTrackingOptions {
  // Running two full hand+pose pipelines at once (trainee camera + cardboard camera) is
  // very GPU/CPU heavy and can stall both video feeds ("hangs") once other work (3D scene,
  // DTW worker, serial writes) piles on top. The cardboard-hand feed doesn't use pose data
  // at all, so pose detection can be skipped there to roughly halve its per-frame cost.
  detectPose?: boolean;
  // A cardboard cutout doesn't have the skin texture/shading MediaPipe's hand model was
  // trained on, so it can score lower confidence than a real hand - lower this for that feed.
  minHandDetectionConfidence?: number;
  minHandPresenceConfidence?: number;
  minTrackingConfidence?: number;
  // Hard cap on inference rate (independent of camera FPS) as a safety valve against
  // overloading the GPU/CPU when multiple tracking pipelines run simultaneously.
  maxFps?: number;
}

export const useHandTracking = (videoElement: HTMLVideoElement | null, options: HandTrackingOptions = {}) => {
  const {
    detectPose = true,
    minHandDetectionConfidence = 0.5,
    minHandPresenceConfidence = 0.5,
    minTrackingConfidence = 0.5,
    maxFps = 30,
  } = options;

  const [handLandmarker, setHandLandmarker] = useState<HandLandmarker | null>(null);
  const [poseLandmarker, setPoseLandmarker] = useState<PoseLandmarker | null>(null);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const requestRef = useRef<number | undefined>(undefined);
  const lastVideoTimeRef = useRef(-1);
  const lastDetectTimeRef = useRef(0);
  const onResultsRef = useRef<((result: BiomechanicalResult) => void) | undefined>(undefined);
  // Mirrors the two model instances for the load-effect's cleanup to close. That cleanup
  // only ever runs once (deps=[detectPose], which never changes after mount), so if it
  // closed over the `handLandmarker`/`poseLandmarker` state directly it would always see
  // the initial `null` values and never actually release the loaded models - a real GPU
  // resource leak every time this component (CameraView) mounts/unmounts across attempts.
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);

  useEffect(() => {
    let active = true;
    const loadModel = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
        );

        let landmarker: HandLandmarker;
        let poseModel: PoseLandmarker | null = null;

        try {
          landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
              delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence,
            minHandPresenceConfidence,
            minTrackingConfidence,
          });

          if (detectPose) {
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
          }
        } catch (e) {
          console.warn("GPU delegate failed, falling back to CPU", e);
          landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
              delegate: "CPU"
            },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence,
            minHandPresenceConfidence,
            minTrackingConfidence,
          });
          if (detectPose) {
            poseModel = await PoseLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
                delegate: "CPU"
              },
              runningMode: "VIDEO",
              numPoses: 1,
            });
          }
        }

        if (active) {
          handLandmarkerRef.current = landmarker;
          poseLandmarkerRef.current = poseModel;
          setHandLandmarker(landmarker);
          setPoseLandmarker(poseModel);
          setIsModelLoaded(true);
        } else {
          landmarker.close();
          poseModel?.close();
        }
      } catch (error: any) {
        console.error("Error loading MediaPipe models:", error);
        setModelError(error.message || "Failed to load AI models. Please check your internet connection.");
      }
    };
    loadModel();

    return () => {
      active = false;
      handLandmarkerRef.current?.close();
      poseLandmarkerRef.current?.close();
      handLandmarkerRef.current = null;
      poseLandmarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectPose]);

  const setOnResults = useCallback((callback: (result: BiomechanicalResult) => void) => {
    onResultsRef.current = callback;
  }, []);

  useEffect(() => {
    if (!handLandmarker || (detectPose && !poseLandmarker) || !videoElement) return;

    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }

    const minInterval = 1000 / maxFps;

    const detect = () => {
      if (videoElement.readyState >= 2) {
        const startTimeMs = performance.now();
        if (
          lastVideoTimeRef.current !== videoElement.currentTime &&
          startTimeMs - lastDetectTimeRef.current >= minInterval
        ) {
          lastVideoTimeRef.current = videoElement.currentTime;
          lastDetectTimeRef.current = startTimeMs;

          const hands = handLandmarker.detectForVideo(videoElement, startTimeMs);
          const pose = poseLandmarker ? poseLandmarker.detectForVideo(videoElement, startTimeMs) : null;

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
  }, [handLandmarker, poseLandmarker, videoElement, detectPose, maxFps]);

  return { isModelLoaded, setOnResults, modelError };
};
