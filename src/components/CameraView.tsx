import React, { useEffect, useRef, useState } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { MotionFrame, MotionPathProfile } from '../types/MotionPath';
import { normalizeHand } from '../utils/deviationEngine';
import { renderLiveHand, renderGhostHand } from '../utils/renderingEngine';
import type { DtwWorkerOutput } from '../utils/dtwWorker';
import { useHandTracking, type BiomechanicalResult } from '../hooks/useHandTracking';
import { useAppStore } from '../store/useAppStore';
import { use3DStore } from '../store/use3DStore';
import type { AttemptRecord } from '../store/useAppStore';
import { Activity, CircleDashed, Square, Play, SquarePlay, DatabaseBackup } from 'lucide-react';
import { DigitalTwin3D } from './DigitalTwin3D';

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  onError?: (error: string) => void;
}

const WINDOW_SIZE = 15; // Number of frames to send to DTW worker for analysis

export const CameraView: React.FC<CameraViewProps> = ({ onStreamReady, onError }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const telemetryCanvasRef = useRef<HTMLCanvasElement>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  
  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const [isWaitingForGesture, setIsWaitingForGesture] = useState(false);
  const isWaitingForGestureRef = useRef(false);
  const recordingStartTimeRef = useRef<number>(0);
  const recordedFramesRef = useRef<MotionFrame[]>([]);
  
  // Playback & Attempt State
  const [isCalibrating, setIsCalibrating] = useState(false);
  const isCalibratingRef = useRef(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const calibrationHoldStartRef = useRef<number>(0);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const playbackStartTimeRef = useRef<number>(0);
  const attemptFramesRef = useRef<MotionFrame[]>([]);
  const attemptScoresRef = useRef<{ timestamp: number; score: DtwWorkerOutput }[]>([]);
  
  const savedProfile = useAppStore(state => state.activeProfile);
  const setSavedProfile = useAppStore(state => state.setActiveProfile);
  const appState = useAppStore(state => state.appState);
  const uploadedVideoUrl = useAppStore(state => state.uploadedVideoUrl);
  const setAppState = useAppStore(state => state.setAppState);
  
  // Live Data tracking for DTW
  const recentLiveFramesRef = useRef<NormalizedLandmark[][]>([]);
  const [dtwScores, setDtwScores] = useState<DtwWorkerOutput | null>(null);
  const telemetryHistoryRef = useRef<number[]>([]);
  
  // Worker Ref
  const workerRef = useRef<Worker | null>(null);

  const { isModelLoaded, setOnResults } = useHandTracking(videoRef.current);

  // Initialize Worker and Load Profile
  useEffect(() => {
    workerRef.current = new Worker(new URL('../utils/dtwWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = (e: MessageEvent<DtwWorkerOutput>) => {
      setDtwScores(e.data);
      if (isPlayingRef.current) {
        attemptScoresRef.current.push({
          timestamp: performance.now() - playbackStartTimeRef.current,
          score: e.data
        });
      }
    };

    const profileJson = localStorage.getItem('osmosis_expert_profile');
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
    setIsWaitingForGesture(true);
    isWaitingForGestureRef.current = true;
    setIsPlaying(false);
    isPlayingRef.current = false;
  };
  
  // Auto-start waiting for gesture when video is uploaded
  useEffect(() => {
    if (appState === 'VIDEO_PROCESS' && uploadedVideoUrl) {
      handleStartRecording();
    }
  }, [appState, uploadedVideoUrl]);
  
  const triggerRecordingStart = () => {
    setIsWaitingForGesture(false);
    isWaitingForGestureRef.current = false;
    recordedFramesRef.current = [];
    recordingStartTimeRef.current = performance.now();
    setIsRecording(true);
    isRecordingRef.current = true;
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    isRecordingRef.current = false;
    if (recordedFramesRef.current.length > 0) {
      const profile: MotionPathProfile = {
        id: Date.now().toString(),
        name: "Expert Path " + new Date().toLocaleTimeString(),
        createdAt: Date.now(),
        duration: performance.now() - recordingStartTimeRef.current,
        frames: recordedFramesRef.current
      };
      localStorage.setItem('osmosis_expert_profile', JSON.stringify(profile));
      setSavedProfile(profile);
    }
  };

  const handleStartPlayback = () => {
    setIsCalibrating(true);
    isCalibratingRef.current = true;
    setCalibrationProgress(0);
    calibrationHoldStartRef.current = 0;
    
    recentLiveFramesRef.current = [];
    attemptFramesRef.current = [];
    attemptScoresRef.current = [];
    setDtwScores(null);
    setIsRecording(false);
    isRecordingRef.current = false;
  };
  
  const triggerPlayback = () => {
    setIsCalibrating(false);
    isCalibratingRef.current = false;
    playbackStartTimeRef.current = performance.now();
    setIsPlaying(true);
    isPlayingRef.current = true;
  };
  
  const handleStopPlayback = () => {
    setIsCalibrating(false);
    isCalibratingRef.current = false;
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
    setDtwScores(null);
  };

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
      const startCamera = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user', frameRate: { ideal: 30 } },
            audio: false,
          });

          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            activeStream = stream;
            videoRef.current.onloadedmetadata = () => {
              setIsReady(true);
              if (onStreamReady) onStreamReady(stream);
            };
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
      };
    }
  }, [appState, uploadedVideoUrl, onStreamReady, onError]);

  // Main Tracking & Rendering Loop
  useEffect(() => {
    let lastWorkerTime = 0;

    setOnResults((result: BiomechanicalResult) => {
      const canvas = canvasRef.current;
      const teleCanvas = telemetryCanvasRef.current;
      const video = videoRef.current;
      if (!canvas || !teleCanvas || !video) return;
      
      const ctx = canvas.getContext('2d');
      const teleCtx = teleCanvas.getContext('2d');
      if (!ctx || !teleCtx) return;
      
      // Match canvas size to display size
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
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
      // Helper to detect a Pinch gesture (Thumb tip touching Index tip)
      const isPinching = (lms: NormalizedLandmark[]) => {
        const dx = lms[4].x - lms[8].x;
        const dy = lms[4].y - lms[8].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist < 0.05; // 5% of screen/bounding box distance
      };

      const hasHand = result.hands?.landmarks && result.hands.landmarks.length > 0;
      const firstPose = result.pose?.landmarks?.[0];

      // 0. Wait for Pinch to start recording
      if (isWaitingForGestureRef.current && hasHand) {
        const hand1Pinch = isPinching(result.hands!.landmarks[0]);
        const hand2Pinch = result.hands!.landmarks.length > 1 ? isPinching(result.hands!.landmarks[1]) : false;
        
        if (hand1Pinch || hand2Pinch) {
          triggerRecordingStart();
        }
      }

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
      
      // -- CALIBRATION PHASE --
      if (isCalibratingRef.current && savedProfile && savedProfile.frames.length > 0) {
        currentGhostFrame = savedProfile.frames[0];
        
        // Render Ghost Hand as yellow/amber during calibration
        if (currentGhostFrame && currentGhostFrame.landmarks.length > 0) {
          currentGhostFrame.landmarks.forEach(handLandmarks => {
            renderGhostHand(ctx, handLandmarks, canvas.width, canvas.height, 50, currentGhostFrame?.poseLandmarks?.[0]); // score 50 = yellow
          });
        }
        
        if (hasHand) {
          // Calculate screen-space Euclidean distance for strict AR alignment
          const liveLms = result.hands!.landmarks[0];
          const ghostLms = currentGhostFrame.landmarks[0];
          
          let totalDist = 0;
          for (let i = 0; i < 21; i++) {
            const dx = liveLms[i].x - ghostLms[i].x;
            const dy = liveLms[i].y - ghostLms[i].y;
            totalDist += Math.sqrt(dx*dx + dy*dy);
          }
          const avgDist = totalDist / 21;
          
          // If aligned (avg distance < threshold), advance timer
          if (avgDist < 0.05) { 
            if (calibrationHoldStartRef.current === 0) calibrationHoldStartRef.current = now;
            const holdDuration = now - calibrationHoldStartRef.current;
            const progress = Math.min(100, (holdDuration / 2000) * 100); // 2 second hold
            setCalibrationProgress(progress);
            
            if (progress >= 100) {
              triggerPlayback();
            }
          } else {
            calibrationHoldStartRef.current = 0;
            setCalibrationProgress(0);
          }
        } else {
          calibrationHoldStartRef.current = 0;
          setCalibrationProgress(0);
        }
      }

      // -- PLAYBACK PHASE --
      else if (isPlayingRef.current && savedProfile && savedProfile.frames.length > 0) {
        const playbackTime = (now - playbackStartTimeRef.current) % savedProfile.duration;
        
        // Find nearest ghost frame for rendering
        let minDiff = Infinity;
        for (const frame of savedProfile.frames) {
          const diff = Math.abs(frame.timestamp - playbackTime);
          if (diff < minDiff) {
            minDiff = diff;
            currentGhostFrame = frame;
          }
        }

        // Render Ghost Hand
        if (currentGhostFrame && currentGhostFrame.landmarks.length > 0) {
          const score = dtwScores?.overallScore ?? 100; // default to cyan
          currentGhostFrame.landmarks.forEach(handLandmarks => {
            renderGhostHand(ctx, handLandmarks, canvas.width, canvas.height, score, currentGhostFrame?.poseLandmarks?.[0]);
          });
        }

        // Update Telemetry History
        if (dtwScores) {
           telemetryHistoryRef.current.push(dtwScores.overallScore);
           if (telemetryHistoryRef.current.length > 100) {
             telemetryHistoryRef.current.shift();
           }
        }

        // DTW Worker Dispatch (Throttle to ~10fps to avoid saturating worker)
        if (hasHand && now - lastWorkerTime > 100) {
          attemptFramesRef.current.push({
            timestamp: playbackTime,
            landmarks: result.hands!.landmarks,
            poseLandmarks: result.pose?.landmarks
          });

          const normalizedLive = normalizeHand(result.hands!.landmarks[0]);
          recentLiveFramesRef.current.push(normalizedLive);
          if (recentLiveFramesRef.current.length > WINDOW_SIZE) {
            recentLiveFramesRef.current.shift();
          }

          // Extract Ghost Window
          const ghostWindow = savedProfile.frames
            .filter(f => Math.abs(f.timestamp - playbackTime) < 500) // +/- 500ms
            .map(f => normalizeHand(f.landmarks[0]));

          if (recentLiveFramesRef.current.length > 5 && ghostWindow.length > 5) {
            workerRef.current?.postMessage({
              liveWindow: [...recentLiveFramesRef.current],
              ghostWindow: ghostWindow
            });
            lastWorkerTime = now;
          }
        }
      } else {
        setDtwScores(null);
      }

      // 3. Render Live Hand (On Video Canvas)
      if (hasHand) {
        result.hands!.landmarks.forEach(handLandmarks => {
          renderLiveHand(ctx, handLandmarks, canvas.width, canvas.height, firstPose);
        });
      }

      ctx.restore();

      // 4. Update 3D Store for Digital Twin
      use3DStore.getState().setFrameData(
        hasHand ? result.hands!.landmarks : null,
        currentGhostFrame && currentGhostFrame.landmarks.length > 0 ? currentGhostFrame.landmarks : null,
        dtwScores,
        canvas.width / canvas.height
      );

      // 5. Render Telemetry Waveform
      import('../utils/renderingEngine').then(({ renderTelemetryWaveform }) => {
         renderTelemetryWaveform(teleCtx, teleCanvas.width, teleCanvas.height, telemetryHistoryRef.current);
      });
    });
  }, [setOnResults, savedProfile, dtwScores, appState]);

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
          {!isRecording && !isWaitingForGesture ? (
            <button className="btn-secondary flex items-center gap-2 bg-black/50 backdrop-blur" onClick={handleStartRecording}>
              <CircleDashed size={16} className="text-red-500" />
              <span>RECORD EXPERT PATH</span>
            </button>
          ) : isWaitingForGesture ? (
            <div className="flex items-center gap-2 bg-yellow-500/20 border border-yellow-500/50 backdrop-blur text-yellow-200 px-6 py-3 rounded-lg">
              <Activity size={16} className="animate-pulse" />
              <span>PINCH INDEX & THUMB TO START</span>
            </div>
          ) : (
            <button className="btn-secondary flex items-center gap-2 bg-red-950/80 border-red-500/50 backdrop-blur text-red-100" onClick={handleStopRecording}>
              <Square size={16} className="text-red-500 fill-red-500" />
              <span>STOP RECORDING</span>
              <span className="ml-2 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            </button>
          )}
        </div>

        {/* Right Side: Playback Controls */}
        <div className="flex flex-col gap-2 pointer-events-auto items-end">
          {savedProfile && (
            <>
              <div className="text-xs font-mono text-accent bg-black/60 backdrop-blur px-3 py-1 rounded-md border border-accent/20 mb-1 flex items-center gap-2">
                <DatabaseBackup size={12} />
                EXPERT PROFILE LOADED
              </div>
              {(!isPlaying && !isCalibrating) && (
                <button className="btn-primary flex items-center gap-2" onClick={handleStartPlayback}>
                  <Play size={16} className="fill-black" />
                  INITIATE DIFFING
                </button>
              )}
              {(isPlaying || isCalibrating) && (
                <button className="btn-secondary flex items-center gap-2 bg-black/80 backdrop-blur border-accent" onClick={handleStopPlayback}>
                  <SquarePlay size={16} className="text-accent" />
                  HALT DIFFING
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Main Workspace Split */}
      <div className="flex-1 flex flex-row relative">
        
        {/* Left: Original Video */}
        <div className="flex-1 relative border-r border-white/10 overflow-hidden bg-black flex items-center justify-center">
          {errorMsg ? (
            <div className="text-center panel p-8 border-red-500/30">
              <h3 className="text-red-500 mb-4 text-xl">System Error</h3>
              <p className="text-text-muted">{errorMsg}</p>
            </div>
          ) : (
            <>
              <div className="absolute top-4 left-4 z-20 text-xs font-mono text-white/50 tracking-widest bg-black/40 px-3 py-1 rounded">ORIGINAL VIDEO</div>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover absolute top-0 left-0 ${appState !== 'VIDEO_PROCESS' ? 'transform -scale-x-100' : ''}`}
                style={{ opacity: isReady ? 1 : 0 }}
              />
              <canvas
                ref={canvasRef}
                className="w-full h-full absolute top-0 left-0 z-10 pointer-events-none"
                style={{ opacity: isReady ? 1 : 0 }}
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

        {/* Right: Digital Twin (3D Rendered) */}
        <div className="flex-1 relative bg-[#0a0a0c] overflow-hidden flex items-center justify-center">
           <div className="absolute top-4 left-4 z-20 text-xs font-mono text-white/50 tracking-widest bg-white/5 px-3 py-1 rounded border border-white/10 backdrop-blur">DIGITAL TWIN (WebGL)</div>
           {/* Grid Background */}
           <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
           <DigitalTwin3D />
        </div>

        {/* Calibration Overlay (Floating in center of split screen) */}
        {isCalibratingRef.current && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-end pb-12 pointer-events-none">
            <div className="panel p-6 bg-black/80 backdrop-blur-xl flex flex-row items-center gap-6 border-accent shadow-[0_0_40px_rgba(6,182,212,0.3)]">
              <div className="flex flex-col gap-2 max-w-sm">
                <h3 className="text-lg font-mono text-white tracking-[0.1em]">CALIBRATING ALIGNMENT</h3>
                <p className="text-text-muted text-xs">
                  Align your hand precisely with the glowing holographic target in the Digital Twin view.
                </p>
              </div>
              <div className="relative w-16 h-16 flex items-center justify-center shrink-0">
                <svg className="absolute inset-0 w-full h-full transform -rotate-90">
                  <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
                  <circle 
                    cx="32" cy="32" r="28" fill="none" 
                    stroke="#06b6d4" strokeWidth="4" 
                    strokeDasharray={176}
                    strokeDashoffset={176 - (176 * calibrationProgress) / 100}
                    className="transition-all duration-75 ease-linear"
                  />
                </svg>
                <div className="text-sm font-mono font-bold text-white">
                  {Math.round(calibrationProgress)}<span className="text-[10px] text-accent">%</span>
                </div>
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
