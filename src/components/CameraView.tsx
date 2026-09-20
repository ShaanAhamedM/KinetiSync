import React, { useEffect, useRef, useState } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { MotionFrame, MotionPathProfile } from '../types/MotionPath';
import { normalizeHand } from '../utils/deviationEngine';
import { renderLiveHand, renderGhostHand, renderTelemetryWaveform } from '../utils/renderingEngine';
import type { DtwWorkerOutput } from '../utils/dtwWorker';
import { useHandTracking, type BiomechanicalResult } from '../hooks/useHandTracking';
import { useVoiceControl } from '../hooks/useVoiceControl';

import { useAppStore } from '../store/useAppStore';
import type { AttemptRecord } from '../store/useAppStore';
import { use3DStore } from '../store/use3DStore';
import { CircleDashed, Square, Play, SquarePlay, DatabaseBackup, Cpu, Mic, MicOff } from 'lucide-react';
import { DigitalTwin3D } from './DigitalTwin3D';
import { hardwareBridge } from '../utils/hardwareBridge';

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  onError?: (error: string) => void;
}

const WINDOW_SIZE = 15; // Number of frames to send to DTW worker for analysis

// Binary search for the recorded expert frame closest to `playbackTime` (ms into the loop).
// Shared by both the trainee-webcam loop and the cardboard-camera loop so either one can
// look up "what should the hand be doing right now" independently.
const findGhostFrame = (frames: MotionFrame[], playbackTime: number): MotionFrame | null => {
  let low = 0;
  let high = frames.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midTime = frames[mid].timestamp;

    if (midTime === playbackTime) return frames[mid];
    else if (midTime < playbackTime) low = mid + 1;
    else high = mid - 1;
  }

  const lowFrame = frames[low];
  const highFrame = frames[high];
  if (lowFrame && !highFrame) return lowFrame;
  if (!lowFrame && highFrame) return highFrame;
  if (lowFrame && highFrame) {
    const lowDiff = Math.abs(lowFrame.timestamp - playbackTime);
    const highDiff = Math.abs(highFrame.timestamp - playbackTime);
    return lowDiff < highDiff ? lowFrame : highFrame;
  }
  return null;
};


export const CameraView: React.FC<CameraViewProps> = ({ onStreamReady, onError }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const secVideoRef = useRef<HTMLVideoElement>(null);
  const [secVideoEl, setSecVideoEl] = useState<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const telemetryCanvasRef = useRef<HTMLCanvasElement>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  
  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);

  const recordingStartTimeRef = useRef<number>(0);
  const recordedFramesRef = useRef<MotionFrame[]>([]);
  
  // Playback & Attempt State
  const [isCountingDown, setIsCountingDown] = useState(false);
  const isCountingDownRef = useRef(false);
  const [countdownValue, setCountdownValue] = useState(5);
  const countdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const playbackStartTimeRef = useRef<number>(0);
  const attemptFramesRef = useRef<MotionFrame[]>([]);
  const attemptScoresRef = useRef<{ timestamp: number; score: DtwWorkerOutput }[]>([]);
  
  const [isHardwareConnected, setIsHardwareConnected] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [recordingTimeStr, setRecordingTimeStr] = useState('00:00');
  
  const savedProfile = useAppStore(state => state.activeProfile);
  const setSavedProfile = useAppStore(state => state.setActiveProfile);
  const appState = useAppStore(state => state.appState);
  const uploadedVideoUrl = useAppStore(state => state.uploadedVideoUrl);
  const setAppState = useAppStore(state => state.setAppState);

  // Declared early (rather than beside the other playback handlers below) so the
  // cardboard-camera calibration effect can reference it without a forward-declaration.
  const triggerPlayback = () => {
    setIsCountingDown(false);
    isCountingDownRef.current = false;
    playbackStartTimeRef.current = performance.now();
    setIsPlaying(true);
    isPlayingRef.current = true;
  };

  // Live Data tracking for DTW.
  // dtwScoresRef mirrors the dtwScores state for the tracking-loop closure below to read -
  // that closure needs the CURRENT score every frame, but depending on the `dtwScores` state
  // directly would tear down and rebuild the whole tracking effect (and reset its throttle
  // timers) on every single worker message (~10x/sec during playback). The ref sidesteps that.
  const recentLiveFramesRef = useRef<NormalizedLandmark[][]>([]);
  const [dtwScores, setDtwScores] = useState<DtwWorkerOutput | null>(null);
  const dtwScoresRef = useRef<DtwWorkerOutput | null>(null);
  const telemetryHistoryRef = useRef<number[]>([]);
  // Shared across BOTH camera loops (trainee webcam and cardboard/phone camera) so that
  // whichever one currently has a hand in frame can drive the diffing score - some demo
  // setups only have the cardboard hand active with nobody in front of the main webcam.
  const lastDtwDispatchTimeRef = useRef(0);

  // Worker Ref
  const workerRef = useRef<Worker | null>(null);

  // Pushes a hand's frame into the DTW comparison window and dispatches to the worker,
  // throttled to ~10fps. Called from either camera loop with whichever hand is available.
  const dispatchDtwFrame = (
    handLandmarks: NormalizedLandmark[][],
    poseLandmarks: NormalizedLandmark[][] | undefined,
    playbackTime: number,
    ghostFrames: MotionFrame[],
    now: number
  ) => {
    if (now - lastDtwDispatchTimeRef.current <= 100) return;

    attemptFramesRef.current.push({
      timestamp: playbackTime,
      landmarks: handLandmarks,
      poseLandmarks
    });

    const normalizedLive = normalizeHand(handLandmarks[0]);
    recentLiveFramesRef.current.push(normalizedLive);
    if (recentLiveFramesRef.current.length > WINDOW_SIZE) {
      recentLiveFramesRef.current.shift();
    }

    const ghostWindow = ghostFrames
      .filter(f => Math.abs(f.timestamp - playbackTime) < 500) // +/- 500ms
      .map(f => normalizeHand(f.landmarks[0]));

    if (recentLiveFramesRef.current.length > 5 && ghostWindow.length > 5) {
      workerRef.current?.postMessage({
        liveWindow: [...recentLiveFramesRef.current],
        ghostWindow
      });
      lastDtwDispatchTimeRef.current = now;
    }
  };

  const { isModelLoaded, setOnResults, modelError } = useHandTracking(videoEl);

  useEffect(() => {
    if (modelError) {
      setErrorMsg(modelError);
    }
  }, [modelError]);

  // Auto-save on unmount if recording (BUG-21)
  useEffect(() => {
    return () => {
      if (isRecordingRef.current && recordedFramesRef.current.length > 0) {
        const duration = recordedFramesRef.current[recordedFramesRef.current.length - 1].timestamp;
        const profile: MotionPathProfile = {
          id: Date.now().toString(),
          name: `Expert Path (Auto-Saved)`,
          duration,
          frames: [...recordedFramesRef.current],
          createdAt: Date.now()
        };
        localStorage.setItem('kinetisync_expert_profile', JSON.stringify(profile));
      }
    };
  }, []);

  // Setup MediaPipe for Cardboard Hand Tracking (hardware feedback).
  // Skip pose detection (unused for the cardboard feed) and relax the hand-detection
  // confidence (a cardboard cutout doesn't look like real skin to the model) - both
  // cut load on this second concurrent tracking pipeline so it doesn't stall.
  const { isModelLoaded: isSecModelLoaded, setOnResults: setSecOnResults } = useHandTracking(secVideoEl, {
    detectPose: false,
    minHandDetectionConfidence: 0.3,
    minHandPresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  });
  const physicalFeedback = use3DStore(state => state.physicalFeedback);
  const lastCommandedAnglesRef = useRef<number[] | null>(null);
  
  const secCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setSecOnResults((result) => {
      const canvas = secCanvasRef.current;
      const ctx = canvas?.getContext('2d');
      
      if (canvas && ctx && secVideoEl) {
        if (canvas.width !== secVideoEl.videoWidth) {
          canvas.width = secVideoEl.videoWidth;
          canvas.height = secVideoEl.videoHeight;
        }
        
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Unlike the primary (selfie) camera, the phone/Camo camera feed is shown
        // un-mirrored (raw, matching the physical world) - see the <video> element below.
        // No canvas transform needed here: drawing landmarks at their raw x already
        // lines up with that un-mirrored video.

        const hasCardboardHand = result.hands && result.hands.landmarks.length > 0;

        // While the countdown runs, show the expert profile's starting pose as a
        // reference on the cardboard camera feed so the trainee knows what to line up
        // with before diffing starts (no alignment gating anymore - just a preview).
        if (isCountingDownRef.current && savedProfile && savedProfile.frames.length > 0) {
          const ghostFrame = savedProfile.frames[0];

          if (ghostFrame.landmarks.length > 0) {
            ghostFrame.landmarks.forEach(handLandmarks => {
              renderGhostHand(ctx, handLandmarks, canvas.width, canvas.height, 50, ghostFrame.poseLandmarks?.[0]); // score 50 = yellow
            });
          }
        }

        if (hasCardboardHand) {
          result.hands!.landmarks.forEach(handLandmarks => {
            renderLiveHand(ctx, handLandmarks, canvas.width, canvas.height, result.pose?.landmarks?.[0]);
          });

          const lm = result.hands!.landmarks[0];
          const tips = [
            { x: lm[4].x, y: lm[4].y },
            { x: lm[8].x, y: lm[8].y },
            { x: lm[12].x, y: lm[12].y },
            { x: lm[16].x, y: lm[16].y },
            { x: lm[20].x, y: lm[20].y }
          ];

          // Actual observed curl angles from the cardboard hand (same formula used to
          // command the servos), so the SYNC% / per-finger error readout below reflects
          // real hardware feedback instead of a placeholder.
          const observedAngles = hardwareBridge.calculateAngles(lm);
          use3DStore.getState().setPhysicalFeedback({ points: tips, angles: observedAngles });
          use3DStore.getState().setCardboardFrameData(result.hands!.landmarks, canvas.width / canvas.height);

          // Feed the diffing score/waveform from the cardboard hand too - some demo setups
          // only have the cardboard hand active with nobody in front of the main webcam, so
          // that camera's own DTW dispatch (above, in the main tracking loop) never fires.
          // The shared throttle in dispatchDtwFrame means whichever camera has a hand when
          // its ~100ms window opens is the one that gets used.
          if (isPlayingRef.current && savedProfile && savedProfile.frames.length > 0) {
            const now = performance.now();
            const playbackTime = (now - playbackStartTimeRef.current) % savedProfile.duration;
            dispatchDtwFrame(result.hands!.landmarks, undefined, playbackTime, savedProfile.frames, now);
          }
        } else {
          use3DStore.getState().setPhysicalFeedback(null);
          use3DStore.getState().setCardboardFrameData(null);
        }
        ctx.restore();
      }
    });
  }, [setSecOnResults, secVideoEl, appState, savedProfile]);

  // Hardware sync: how closely the cardboard hand's observed finger angles match
  // the angles we last commanded it to move to.
  let hwSyncScore: number | null = null;
  let hwFingerErrors: number[] | null = null;
  if (physicalFeedback && lastCommandedAnglesRef.current) {
    const commanded = lastCommandedAnglesRef.current;
    hwFingerErrors = physicalFeedback.angles.map((observed, i) => Math.abs(observed - (commanded[i] ?? observed)));
    const avgErr = hwFingerErrors.reduce((a, b) => a + b, 0) / hwFingerErrors.length;
    hwSyncScore = Math.max(0, 100 - (avgErr / 180) * 100);
  }

  // Initialize Worker and Load Profile
  useEffect(() => {
    workerRef.current = new Worker(new URL('../utils/dtwWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = (e: MessageEvent<DtwWorkerOutput>) => {
      dtwScoresRef.current = e.data;
      setDtwScores(e.data);
      if (isPlayingRef.current) {
        attemptScoresRef.current.push({
          timestamp: performance.now() - playbackStartTimeRef.current,
          score: e.data
        });
      }
    };

    const profileJson = localStorage.getItem('kinetisync_expert_profile');
    if (profileJson) {
      try {
        setSavedProfile(JSON.parse(profileJson));
      } catch (e) {
        console.error("Failed to parse saved profile");
      }
    }

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const handleStartRecording = () => {
    if (isPlayingRef.current || isCountingDownRef.current) return;
    setIsPlaying(false);
    isPlayingRef.current = false;
    
    recordedFramesRef.current = [];
    recordingStartTimeRef.current = performance.now();
    setIsRecording(true);
    isRecordingRef.current = true;
  };
  
  // Auto-start waiting for gesture when video is uploaded
  useEffect(() => {
    if (appState === 'VIDEO_PROCESS' && uploadedVideoUrl) {
      handleStartRecording();
    }
  }, [appState, uploadedVideoUrl]);

  const handleStopRecording = () => {
    setIsRecording(false);
    isRecordingRef.current = false;
    if (recordedFramesRef.current.length === 0) {
      console.warn("No frames recorded (no hand detected).");
      setToastMsg("Error: No hand detected during recording");
      setTimeout(() => setToastMsg(null), 3000);
      return;
    }

    const duration = recordedFramesRef.current[recordedFramesRef.current.length - 1].timestamp;
    const profile: MotionPathProfile = {
      id: Date.now().toString(),
      name: `Expert Path ${new Date().toLocaleTimeString()}`,
      duration,
      frames: [...recordedFramesRef.current],
      createdAt: Date.now()
    };

    localStorage.setItem('kinetisync_expert_profile', JSON.stringify(profile));
    setSavedProfile(profile);
    setToastMsg("Expert Profile Saved Successfully!");
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleStartPlayback = () => {
    if (isRecordingRef.current) return;

    if (countdownTimeoutRef.current) {
      clearTimeout(countdownTimeoutRef.current);
      countdownTimeoutRef.current = null;
    }

    setIsCountingDown(true);
    isCountingDownRef.current = true;
    setCountdownValue(5);

    recentLiveFramesRef.current = [];
    attemptFramesRef.current = [];
    attemptScoresRef.current = [];
    dtwScoresRef.current = null;
    setDtwScores(null);
    setIsRecording(false);
    isRecordingRef.current = false;

    // Simple 5-second countdown (5,4,3,2,1) then diffing starts automatically -
    // no more "hold your hand aligned" gating.
    let remaining = 5;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        countdownTimeoutRef.current = null;
        triggerPlayback();
        return;
      }
      setCountdownValue(remaining);
      countdownTimeoutRef.current = setTimeout(tick, 1000);
    };
    countdownTimeoutRef.current = setTimeout(tick, 1000);
  };

  const handleStopPlayback = () => {
    if (countdownTimeoutRef.current) {
      clearTimeout(countdownTimeoutRef.current);
      countdownTimeoutRef.current = null;
    }
    setIsCountingDown(false);
    isCountingDownRef.current = false;
    setIsPlaying(false);
    isPlayingRef.current = false;

    if (attemptFramesRef.current.length > 0 && savedProfile) {
      const attempt: AttemptRecord = {
        id: Date.now().toString(),
        expertProfileId: savedProfile.id,
        timestamp: Date.now(),
        duration: performance.now() - playbackStartTimeRef.current,
        frames: attemptFramesRef.current,
        scores: attemptScoresRef.current,
      };
      useAppStore.getState().addAttempt(attempt);
      useAppStore.getState().setActiveAttempt(attempt);
      useAppStore.getState().setAppState('REPLAY');
    }
    dtwScoresRef.current = null;
    setDtwScores(null);
  };

  const handleConnectHardware = async () => {
    const res = await hardwareBridge.connect();
    setIsHardwareConnected(res.success);
    if (!res.success && res.error && !res.error.includes("No port selected")) {
      setToastMsg(`Hardware Error: ${res.error}`);
      setTimeout(() => setToastMsg(null), 3000);
    }
  };

  const handleStopAll = () => {
    if (isRecordingRef.current) handleStopRecording();
    if (isPlayingRef.current || isCountingDownRef.current) handleStopPlayback();
  };

  // Clear any in-flight countdown timer if the component unmounts mid-countdown.
  useEffect(() => {
    return () => {
      if (countdownTimeoutRef.current) clearTimeout(countdownTimeoutRef.current);
    };
  }, []);

  const { isListening, toggleListening } = useVoiceControl({
    'kinetisync record': handleStartRecording,
    'kinetisync stop': handleStopAll,
    'kinetisync execute': handleStartPlayback,
    'connect hardware': handleConnectHardware
  });

  // Recording Timer updates
  useEffect(() => {
    let interval: any;
    if (isRecording) {
      interval = setInterval(() => {
        const ms = performance.now() - recordingStartTimeRef.current;
        const seconds = Math.floor(ms / 1000);
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        setRecordingTimeStr(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      }, 100);
    } else {
      setRecordingTimeStr('00:00');
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  // Camera or Video Initialization
  useEffect(() => {
    if (appState === 'VIDEO_PROCESS' && uploadedVideoUrl) {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = uploadedVideoUrl;
        videoRef.current.loop = false;
        videoRef.current.onloadedmetadata = () => {
          setIsReady(true);
        };
        videoRef.current.onended = () => {
          if (isRecordingRef.current) {
            handleStopRecording();
          }
          setAppState('LANDING');
        };
      }
      return () => {
        if (videoRef.current) {
          videoRef.current.onended = null;
          videoRef.current.src = "";
        }
      };
    } else {
      let activeStream: MediaStream | null = null;
      let secStream: MediaStream | null = null;
      const startCamera = async () => {
        try {
          // Request generic access first so device labels are populated for enumeration below.
          const initialStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user', frameRate: { ideal: 30 } },
            audio: false,
          });

          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = devices.filter(d => d.kind === 'videoinput');
          const camoDevice = videoInputs.find(d => d.label.toLowerCase().includes('camo'));
          const primaryDevice = videoInputs.find(d => d !== camoDevice) ?? videoInputs[0];

          // Re-acquire the primary (laptop) camera by explicit deviceId so it never
          // accidentally lands on the Camo virtual camera.
          let stream = initialStream;
          if (primaryDevice && primaryDevice.deviceId && (!camoDevice || initialStream.getVideoTracks()[0]?.label !== primaryDevice.label)) {
            try {
              const pinnedStream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: primaryDevice.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
                audio: false,
              });
              initialStream.getTracks().forEach(track => track.stop());
              stream = pinnedStream;
            } catch (pinError) {
              console.warn("Could not pin primary camera, using default stream", pinError);
            }
          }

          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            activeStream = stream;
            videoRef.current.onloadedmetadata = () => {
              setIsReady(true);
              videoRef.current?.play().catch(e => console.error("Auto-play prevented", e));
              if (onStreamReady) onStreamReady(stream);
            };
          }

          // Bottom-left "cardboard hand" feed: always the Camo (phone) camera when present.
          try {
            if (camoDevice) {
              secStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: camoDevice.deviceId } } });
              if (secVideoRef.current) {
                secVideoRef.current.srcObject = secStream;
                secVideoRef.current.play().catch(e => console.error("Secondary auto-play prevented", e));
              }
            } else {
              console.warn("Camo Camera not found among video inputs; falling back to primary feed clone.");
              secStream = stream.clone();
              if (secVideoRef.current) {
                secVideoRef.current.srcObject = secStream;
                secVideoRef.current.play().catch(e => console.error("Secondary auto-play prevented", e));
              }
            }
          } catch (secError) {
            console.warn("Could not attach secondary (Camo) camera", secError);
          }
        } catch (err: any) {
          const msg = err.name === 'NotAllowedError' ? "Camera access denied." : "Could not access camera.";
          setErrorMsg(msg);
          if (onError) onError(msg);
        }
      };
      startCamera();
      return () => {
        if (activeStream) activeStream.getTracks().forEach(track => track.stop());
        if (secStream) secStream.getTracks().forEach(track => track.stop());
      };
    }
  }, [appState, uploadedVideoUrl, onStreamReady, onError]);

  // Main Tracking & Rendering Loop
  useEffect(() => {
    let lastHardwareSendTime = 0;

    setOnResults((result: BiomechanicalResult) => {
      const canvas = canvasRef.current;
      const teleCanvas = telemetryCanvasRef.current;
      const video = videoRef.current;
      if (!canvas || !teleCanvas || !video) return;
      
      const ctx = canvas.getContext('2d');
      const teleCtx = teleCanvas.getContext('2d');
      if (!ctx || !teleCtx) return;
      
      // Match canvas size to display size, handling object-fit cover
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          const videoRatio = video.videoWidth / video.videoHeight;
          const containerRatio = canvas.clientWidth / canvas.clientHeight;
          
          let drawWidth = canvas.clientWidth;
          let drawHeight = canvas.clientHeight;
          
          if (containerRatio > videoRatio) {
            drawHeight = canvas.clientWidth / videoRatio;
          } else {
            drawWidth = canvas.clientHeight * videoRatio;
          }
          
          canvas.width = drawWidth;
          canvas.height = drawHeight;
        } else {
          canvas.width = canvas.clientWidth;
          canvas.height = canvas.clientHeight;
        }
        teleCanvas.width = teleCanvas.clientWidth;
        teleCanvas.height = teleCanvas.clientHeight;
      }

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      if (appState !== 'VIDEO_PROCESS') {
        ctx.scale(-1, 1); // Mirror X for live overlay
        ctx.translate(-canvas.width, 0);
      }


      const now = performance.now();

      const hasHand = result.hands?.landmarks && result.hands.landmarks.length > 0;
      const firstPose = result.pose?.landmarks?.[0];

      // 1. Capture Data if Recording
      if (isRecordingRef.current && hasHand) {
        recordedFramesRef.current.push({
          timestamp: now - recordingStartTimeRef.current,
          landmarks: result.hands!.landmarks,
          poseLandmarks: result.pose?.landmarks
        });
      }

      // 2. Playback & DTW Analysis
      let currentGhostFrame: MotionFrame | null = null;
      
      // -- COUNTDOWN PHASE --
      // Keep the ghost frame pinned to frame 0 so the Digital Twin's ghost hand is
      // visible as a preview while the 5-second countdown runs before diffing starts.
      if (isCountingDownRef.current && savedProfile && savedProfile.frames.length > 0) {
        currentGhostFrame = savedProfile.frames[0];
      }

      // -- PLAYBACK PHASE --
      else if (isPlayingRef.current && savedProfile && savedProfile.frames.length > 0) {
        const playbackTime = (now - playbackStartTimeRef.current) % savedProfile.duration;
        currentGhostFrame = findGhostFrame(savedProfile.frames, playbackTime);

        // Render Ghost Hand
        if (currentGhostFrame && currentGhostFrame.landmarks.length > 0) {
          const score = dtwScoresRef.current?.overallScore ?? 100; // default to cyan
          currentGhostFrame.landmarks.forEach(handLandmarks => {
            renderGhostHand(ctx, handLandmarks, canvas.width, canvas.height, score, currentGhostFrame?.poseLandmarks?.[0]);
          });
        }

        // Update Telemetry History
        if (dtwScoresRef.current) {
           telemetryHistoryRef.current.push(dtwScoresRef.current.overallScore);
           if (telemetryHistoryRef.current.length > 100) {
             telemetryHistoryRef.current.shift();
           }
        }

        // DTW Worker Dispatch (Throttle to ~10fps to avoid saturating worker).
        // Uses the trainee webcam's hand when present - the cardboard camera loop below
        // dispatches its own frames the same way when this camera has nothing to offer.
        if (hasHand) {
          dispatchDtwFrame(result.hands!.landmarks, result.pose?.landmarks, playbackTime, savedProfile.frames, now);
        }
      } else {
        dtwScoresRef.current = null;
        setDtwScores(null);
      }

      // 3. Render Live Hand (On Video Canvas)
      if (hasHand) {
        result.hands!.landmarks.forEach(handLandmarks => {
          renderLiveHand(ctx, handLandmarks, canvas.width, canvas.height, firstPose);
        });
      }

      // Send Hardware Angles (throttled to ~30fps, independent of the DTW worker throttle)
      if (now - lastHardwareSendTime > 30) {
        // While diffing is active, the cardboard hand must physically re-enact the
        // recorded EXPERT path (the ghost frame at the current playback time), not
        // whatever the trainee's live hand is doing - that's the whole point of
        // "Initiate Diffing": showing the correct motion on the physical hand.
        if (isPlayingRef.current && currentGhostFrame && currentGhostFrame.landmarks.length > 0) {
          const expertHand = currentGhostFrame.landmarks[0];
          const angles = hardwareBridge.calculateAngles(expertHand);
          lastCommandedAnglesRef.current = angles;
          hardwareBridge.sendAngles(angles);
          lastHardwareSendTime = now;
        } else if (hasHand) {
          const liveHand = result.hands!.landmarks[0];
          const angles = hardwareBridge.calculateAngles(liveHand);
          lastCommandedAnglesRef.current = angles;
          hardwareBridge.sendAngles(angles);
          lastHardwareSendTime = now;
        }
      }

      ctx.restore();

      // 4. Update 3D Store for Digital Twin
      use3DStore.getState().setFrameData(
        hasHand ? result.hands!.landmarks : null,
        currentGhostFrame && currentGhostFrame.landmarks.length > 0 ? currentGhostFrame.landmarks : null,
        dtwScoresRef.current,
        canvas.width / canvas.height
      );

      // 5. Render Telemetry Waveform
      renderTelemetryWaveform(teleCtx, teleCanvas.width, teleCanvas.height, telemetryHistoryRef.current);
    });
  }, [setOnResults, savedProfile, appState]);

  // Extract pinch distance for "Grip Force"
  let gripForce = 0;
  if (dtwScores && dtwScores.fingerScores.thumb) {
     gripForce = Math.min(100, Math.max(0, 100 - (dtwScores.fingerScores.thumb / 2)));
  }

  return (
    <div className="absolute inset-0 w-full h-full overflow-hidden bg-black flex flex-col">
      
      {/* Top HUD Controls */}
      <div className="absolute top-4 left-4 right-4 z-50 flex justify-between items-start pointer-events-none">
        
        {/* Left Side: Recording Controls */}
        <div className="flex flex-col gap-2 pointer-events-auto">
          {!isRecording ? (
            <button 
              disabled={!isModelLoaded || !isReady}
              className={`btn-secondary flex items-center gap-2 bg-black/50 backdrop-blur ${(!isModelLoaded || !isReady) ? 'opacity-50 cursor-not-allowed' : ''}`} 
              onClick={handleStartRecording}
            >
              <CircleDashed size={16} className="text-red-500" />
              <span>RECORD EXPERT PATH</span>
            </button>
          ) : (
            <button className="btn-secondary flex items-center justify-between gap-4 bg-red-950/80 border-red-500/50 backdrop-blur text-red-100 min-w-[200px]" onClick={handleStopRecording}>
              <div className="flex items-center gap-2">
                <Square size={16} className="text-red-500 fill-red-500" />
                <span>STOP RECORDING</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-sm">
                <span>{recordingTimeStr}</span>
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              </div>
            </button>
          )}
        </div>

        {/* Right Side: Playback Controls */}
        <div className="flex flex-col gap-2 pointer-events-auto items-end">
          <button 
            className={`btn-secondary flex items-center gap-2 backdrop-blur mb-2 ${isListening ? 'border-red-500 text-red-500 bg-red-500/10' : 'border-white/20'}`}
            onClick={toggleListening}
          >
            {isListening ? <Mic size={16} className="animate-pulse" /> : <MicOff size={16} className="text-white/50" />}
            {isListening ? 'VOICE COMMAND ACTIVE' : 'ENABLE VOICE CONTROL'}
          </button>
          
          <button 
            className={`btn-secondary flex items-center gap-2 backdrop-blur mb-2 ${isHardwareConnected ? 'border-accent text-accent' : 'border-white/20'}`}
            onClick={handleConnectHardware}
          >
            <Cpu size={16} className={isHardwareConnected ? "text-accent animate-pulse" : "text-white/50"} />
            {isHardwareConnected ? 'ARDUINO CONNECTED' : 'CONNECT HARDWARE'}
          </button>
          
          {savedProfile && (
            <>
              <div className="text-xs font-mono text-accent bg-black/60 backdrop-blur px-3 py-1 rounded-md border border-accent/20 mb-1 flex items-center gap-2">
                <DatabaseBackup size={12} />
                EXPERT PROFILE LOADED
              </div>
              {(!isPlaying && !isCountingDown) && (
                <button
                  disabled={!isModelLoaded || !isReady}
                  className={`btn-primary flex items-center gap-2 ${(!isModelLoaded || !isReady) ? 'opacity-50 cursor-not-allowed' : ''}`}
                  onClick={handleStartPlayback}
                >
                  <Play size={16} className="fill-black" />
                  INITIATE DIFFING
                </button>
              )}
              {(isPlaying || isCountingDown) && (
                <button className="btn-secondary flex items-center gap-2 bg-black/80 backdrop-blur border-accent" onClick={handleStopPlayback}>
                  <SquarePlay size={16} className="text-accent" />
                  HALT DIFFING
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Toast Notification */}
      {toastMsg && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-[100] bg-black/80 border border-accent/50 text-white px-6 py-3 rounded-lg shadow-2xl backdrop-blur">
          {toastMsg}
        </div>
      )}

      {/* Main Workspace Split */}
      <div className="flex-1 flex flex-row relative">
        
        {/* Left: Video Feeds */}
        <div className="flex-1 flex flex-col relative border-r border-white/10 overflow-hidden bg-black">
          
          {/* Top: Original Video */}
          <div className="flex-1 relative border-b border-white/10 flex items-center justify-center">
          {errorMsg ? (
            <div className="text-center panel p-8 border-red-500/30">
              <h3 className="text-red-500 mb-4 text-xl">System Error</h3>
              <p className="text-text-muted">{errorMsg}</p>
            </div>
          ) : (
            <>
              <div className="absolute top-4 left-4 z-20 text-xs font-mono text-white/50 tracking-widest bg-black/40 px-3 py-1 rounded">ORIGINAL VIDEO</div>
              <video
                ref={(el) => {
                   if (el) videoRef.current = el;
                   if (el && el !== videoEl) setVideoEl(el);
                }}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover absolute top-0 left-0 ${appState !== 'VIDEO_PROCESS' ? 'transform -scale-x-100' : ''}`}
                style={{ opacity: isReady ? 1 : 0 }}
              />
              <canvas
                ref={canvasRef}
                className="w-full h-full absolute top-0 left-0 z-10 pointer-events-none"
                style={{ opacity: (isReady && isModelLoaded) ? 1 : 0 }}
              />
              {/* Loading Overlays */}
              {(!isReady || !isModelLoaded) && !errorMsg && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/80 backdrop-blur-sm">
                  <div className="w-12 h-12 rounded-full border-4 border-white/10 border-t-accent animate-spin mb-4" />
                  <p className="text-text-muted font-mono tracking-widest text-xs">
                    {!isReady ? 'INITIALIZING OPTICS...' : 'LOADING NEURAL ENGINE...'}
                  </p>
                </div>
              )}
            </>
          )}
          </div>

          {/* Bottom: Hardware Optical Flow Video */}
          <div className="flex-1 relative flex items-center justify-center bg-[#050505]">
            <div className="absolute top-4 left-4 z-20 text-xs font-mono text-white/50 tracking-widest bg-black/40 px-3 py-1 rounded flex items-center gap-2">
              <span>CARDBOARD HAND TRACKING {isSecModelLoaded ? '🟢' : '🔴'}</span>
              {hwSyncScore !== null && (
                <span className={hwSyncScore > 80 ? 'text-accent' : hwSyncScore > 50 ? 'text-yellow-400' : 'text-red-500'}>
                  SYNC {hwSyncScore.toFixed(0)}%
                </span>
              )}
            </div>
            
            {!isSecModelLoaded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/80 backdrop-blur-sm">
                <div className="w-12 h-12 rounded-full border-4 border-white/10 border-t-accent animate-spin mb-4" />
                <p className="text-text-muted font-mono tracking-widest text-xs">
                  LOADING NEURAL ENGINE...
                </p>
              </div>
            )}
            <video
              ref={(el) => {
                 if (el) secVideoRef.current = el;
                 if (el && el !== secVideoEl) setSecVideoEl(el);
              }}
              autoPlay
              playsInline
              muted
              // Shown un-mirrored (raw) on purpose - this camera is pointed AT the cardboard
              // hand, not a selfie view, so mirroring it made it confusing to line up.
              className="w-full h-full object-cover absolute top-0 left-0"
            />
            {/* Tracking Overlay */}
            <canvas
              ref={secCanvasRef}
              className="w-full h-full absolute top-0 left-0 z-10 pointer-events-none"
              style={{ opacity: isSecModelLoaded ? 1 : 0 }}
            />
            {hwFingerErrors && (
              <div className="absolute bottom-4 left-4 z-20 flex gap-2">
                {['T', 'I', 'M', 'R', 'P'].map((label, i) => (
                  <div key={label} className="flex flex-col items-center gap-1 bg-black/60 px-2 py-1 rounded">
                    <span className="text-[9px] font-mono text-white/50">{label}</span>
                    <span className={`text-[9px] font-mono ${hwFingerErrors![i] < 30 ? 'text-accent' : hwFingerErrors![i] < 70 ? 'text-yellow-400' : 'text-red-500'}`}>
                      ±{hwFingerErrors[i].toFixed(0)}°
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          
        </div>

        {/* Right: Digital Twin (3D Rendered) */}
        <div className="flex-1 relative bg-[#0a0a0c] overflow-hidden flex items-center justify-center">
           <div className="absolute top-4 left-4 z-20 text-xs font-mono text-white/50 tracking-widest bg-white/5 px-3 py-1 rounded border border-white/10 backdrop-blur">DIGITAL TWIN (WebGL)</div>
           <div className="absolute top-4 right-4 z-20 flex flex-col gap-1 text-[9px] font-mono text-white/50 bg-white/5 px-3 py-2 rounded border border-white/10 backdrop-blur">
             <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-white" />LIVE HAND</div>
             <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#f97316' }} />CARDBOARD HAND</div>
             {savedProfile && <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-accent" />EXPERT GHOST</div>}
           </div>
           {/* Grid Background */}
           <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
           <DigitalTwin3D />
        </div>

        {/* Countdown Overlay (Floating in center of split screen) */}
        {isCountingDownRef.current && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center pointer-events-none">
            <div className="panel p-8 bg-black/80 backdrop-blur-xl flex flex-col items-center gap-3 border-accent shadow-[0_0_40px_rgba(6,182,212,0.3)]">
              <h3 className="text-sm font-mono text-white/70 tracking-[0.2em]">DIFFING STARTS IN</h3>
              <div
                key={countdownValue}
                className="text-7xl font-mono font-bold text-accent animate-pulse"
                style={{ textShadow: '0 0 40px rgba(6,182,212,0.6)' }}
              >
                {countdownValue}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Dashboard */}
      <div className="h-48 border-t border-white/10 bg-[#0f0f13] flex flex-row relative z-30">
        
        {/* Force Meters */}
        <div className="w-[30%] border-r border-white/10 p-4 flex flex-col gap-4">
          <div className="flex justify-between items-center">
             <div className="text-[10px] font-mono text-white/50 tracking-widest">GRIP FORCE</div>
             <div className="text-xs font-mono text-white">{gripForce.toFixed(1)} N</div>
          </div>
          <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
             <div className="h-full bg-orange-500 transition-all duration-75" style={{ width: `${gripForce}%` }} />
          </div>

          <div className="mt-2 text-[10px] font-mono text-white/50 tracking-widest border-b border-white/10 pb-2 mb-2">LOCAL DEVIATION VECTORS</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {[
              { label: 'THMB', score: dtwScores?.fingerScores?.thumb || 0 },
              { label: 'INDX', score: dtwScores?.fingerScores?.index || 0 },
              { label: 'MIDL', score: dtwScores?.fingerScores?.middle || 0 },
              { label: 'RING', score: dtwScores?.fingerScores?.ring || 0 },
            ].map(f => (
               <div key={f.label} className="flex flex-col gap-1">
                 <div className="flex justify-between items-end">
                   <span className="text-[9px] text-white/70 font-mono">{f.label}</span>
                   <span className="text-[9px] text-white/50 font-mono">{f.score.toFixed(0)}%</span>
                 </div>
                 <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                   <div 
                     className={`h-full rounded-full transition-all duration-300 ease-out ${f.score > 80 ? 'bg-accent' : f.score > 50 ? 'bg-yellow-400' : 'bg-red-500'}`}
                     style={{ width: `${f.score}%` }}
                   />
                 </div>
               </div>
            ))}
          </div>
        </div>

        {/* Global Sync Chart */}
        <div className="flex-1 p-4 flex flex-col gap-2 relative">
           <div className="flex justify-between items-center z-10 relative">
             <div className="flex items-center gap-2">
               <div className="text-[10px] font-mono text-white/50 tracking-widest">GLOBAL SYNC WAVEFORM</div>
               <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
             </div>
             <div className="text-2xl font-mono font-bold text-accent">
                {dtwScores?.overallScore || 0}<span className="text-sm text-white/30 ml-1">%</span>
             </div>
           </div>
           
           <div className="absolute inset-x-4 top-12 bottom-4 bg-black/40 border border-white/5 rounded-lg overflow-hidden">
              <canvas ref={telemetryCanvasRef} className="w-full h-full" />
           </div>
        </div>

      </div>
    </div>
  );
};
