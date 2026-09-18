import { useEffect, useRef, useState, useCallback } from 'react';

declare global {
  interface Window {
    cv: any;
  }
}

export interface Point {
  x: number;
  y: number;
}

export interface FlowResult {
  points: Point[];
  // Per-finger curl angle (0-180deg), same convention as hardwareBridge.calculateAngles:
  // 0 = fully extended, 180 = fully curled. Index 0=thumb, 1=index, 2=middle, 3=ring, 4=pinky.
  angles: number[];
}

// Point 0 = palm/wrist anchor. Points 1-5 = thumb, index, middle, ring, pinky tips.
export const REQUIRED_POINTS = 6;

const mapToAngle = (distance: number, min: number, max: number) => {
  if (max - min < 1e-6) return 90; // Not enough range observed yet, assume neutral
  const clamped = Math.max(min, Math.min(max, distance));
  const percentage = 1 - (clamped - min) / (max - min);
  return Math.round(percentage * 180);
};

export const useOpticalFlow = (videoElement: HTMLVideoElement | null) => {
  const [isCvReady, setIsCvReady] = useState(false);
  const [trackingPoints, setTrackingPoints] = useState<Point[]>([]);

  // OpenCV WebAssembly references
  const oldGrayRef = useRef<any>(null);
  const p0Ref = useRef<any>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const requestRef = useRef<number | undefined>(undefined);

  const onResultsRef = useRef<((result: FlowResult) => void) | undefined>(undefined);

  // Auto-calibrated per-finger [min, max] palm-to-tip distance, used to map distance -> angle
  const rangeRef = useRef<{ min: number; max: number }[]>(
    Array.from({ length: 5 }, () => ({ min: Infinity, max: -Infinity }))
  );

  // Dynamically load OpenCV to prevent freezing the browser on page load
  useEffect(() => {
    if (document.getElementById('opencv-script')) return;
    const script = document.createElement('script');
    script.id = 'opencv-script';
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.async = true;
    script.onload = () => {
      let interval: number;
      const checkCv = () => {
        if (window.cv && window.cv.Mat) {
          setIsCvReady(true);
          clearInterval(interval);
        }
      };
      interval = window.setInterval(checkCv, 500);
      checkCv();
    };
    document.body.appendChild(script);
  }, []);

  // Initialize hidden canvas for frame grabbing
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvasRef.current = canvas;
      ctxRef.current = canvas.getContext('2d', { willReadFrequently: true });
    }
  }, []);

  const setOnFlowResults = useCallback((cb: (result: FlowResult) => void) => {
    onResultsRef.current = cb;
  }, []);

  const addTrackingPoint = useCallback((x: number, y: number) => {
    setTrackingPoints(prev => {
      if (prev.length >= REQUIRED_POINTS) return prev;
      const newPoints = [...prev, { x, y }];

      // Reset tracking matrices if we add a new point so it gets picked up
      if (oldGrayRef.current) oldGrayRef.current.delete();
      if (p0Ref.current) p0Ref.current.delete();
      oldGrayRef.current = null;
      p0Ref.current = null;

      return newPoints;
    });
  }, []);

  const resetTracking = useCallback(() => {
    setTrackingPoints([]);
    if (oldGrayRef.current) oldGrayRef.current.delete();
    if (p0Ref.current) p0Ref.current.delete();
    oldGrayRef.current = null;
    p0Ref.current = null;
    rangeRef.current = Array.from({ length: 5 }, () => ({ min: Infinity, max: -Infinity }));
  }, []);

  const computeAngles = (points: Point[]): number[] => {
    const palm = points[0];
    return [1, 2, 3, 4, 5].map((idx, fingerIdx) => {
      const tip = points[idx];
      const dist = Math.sqrt((tip.x - palm.x) ** 2 + (tip.y - palm.y) ** 2);

      const range = rangeRef.current[fingerIdx];
      range.min = Math.min(range.min, dist);
      range.max = Math.max(range.max, dist);

      return mapToAngle(dist, range.min, range.max);
    });
  };

  // Optical Flow Loop
  useEffect(() => {
    if (!isCvReady || !videoElement || trackingPoints.length === 0) return;

    const cv = window.cv;
    let active = true;

    // We only process once all anchor + fingertip points are placed to save CPU
    if (trackingPoints.length !== REQUIRED_POINTS) return;

    const processFrame = () => {
      if (!active || videoElement.readyState < 2) {
        requestRef.current = requestAnimationFrame(processFrame);
        return;
      }

      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      if (!canvas || !ctx) return;

      if (canvas.width !== videoElement.videoWidth) {
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
      }

      // Draw current video frame to hidden canvas
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Create Mat from image data
      const frame = cv.matFromImageData(imageData);
      const frameGray = new cv.Mat();
      cv.cvtColor(frame, frameGray, cv.COLOR_RGBA2GRAY);

      // Initialize tracking if not done yet
      if (!oldGrayRef.current || !p0Ref.current) {
        oldGrayRef.current = frameGray.clone();

        // Push user-clicked tracking points into OpenCV Mat
        p0Ref.current = new cv.Mat(trackingPoints.length, 1, cv.CV_32FC2);
        for (let i = 0; i < trackingPoints.length; i++) {
           p0Ref.current.data32F[i * 2] = trackingPoints[i].x * canvas.width;
           p0Ref.current.data32F[i * 2 + 1] = trackingPoints[i].y * canvas.height;
        }

        frame.delete();
        frameGray.delete();
        requestRef.current = requestAnimationFrame(processFrame);
        return;
      }

      // Arrays for Optical Flow outputs
      const p1 = new cv.Mat();
      const status = new cv.Mat();
      const err = new cv.Mat();
      const winSize = new cv.Size(15, 15);
      const maxLevel = 2;
      const criteria = new cv.TermCriteria(cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_COUNT, 10, 0.03);

      // Calculate Lucas-Kanade Optical Flow
      try {
        cv.calcOpticalFlowPyrLK(
          oldGrayRef.current,
          frameGray,
          p0Ref.current,
          p1,
          status,
          err,
          winSize,
          maxLevel,
          criteria
        );

        // Extract new points
        const updatedPoints: Point[] = [];
        for (let i = 0; i < status.rows; i++) {
          if (status.data[i] === 1) { // Point successfully tracked
            updatedPoints.push({
              x: p1.data32F[i * 2] / canvas.width,
              y: p1.data32F[i * 2 + 1] / canvas.height
            });
          } else {
            // Point lost, fallback to old point
            updatedPoints.push(trackingPoints[i]);
          }
        }

        // Notify UI/State of new points + derived per-finger curl angles
        if (onResultsRef.current) {
          onResultsRef.current({ points: updatedPoints, angles: computeAngles(updatedPoints) });
        }

        // Update matrices for next frame
        oldGrayRef.current.delete();
        p0Ref.current.delete();
        oldGrayRef.current = frameGray.clone();
        p0Ref.current = p1.clone();

      } catch (e) {
        console.error("Optical Flow Error:", e);
      } finally {
        // Cleanup memory
        frame.delete();
        frameGray.delete();
        p1.delete();
        status.delete();
        err.delete();
      }

      requestRef.current = requestAnimationFrame(processFrame);
    };

    requestRef.current = requestAnimationFrame(processFrame);

    return () => {
      active = false;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isCvReady, videoElement, trackingPoints]);

  return { isCvReady, trackingPoints, addTrackingPoint, resetTracking, setOnFlowResults };
};
