import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { renderLiveHand, renderGhostHand, updateAndDrawParticles } from '../utils/renderingEngine';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Play, Pause, ChevronLeft } from 'lucide-react';

export const ReplayView: React.FC = () => {
  const setAppState = useAppStore(state => state.setAppState);
  const attempt = useAppStore(state => state.activeAttempt);
  const profile = useAppStore(state => state.activeProfile);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  
  const reqRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(performance.now());

  useEffect(() => {
    if (!attempt || !profile) return;
    
    const tick = (now: number) => {
      if (isPlaying) {
        const delta = now - lastTimeRef.current;
        setCurrentTime(prev => {
          let next = prev + delta;
          if (next >= attempt.duration) {
            setIsPlaying(false);
            return attempt.duration;
          }
          return next;
        });
      }
      lastTimeRef.current = now;
      reqRef.current = requestAnimationFrame(tick);
    };
    
    reqRef.current = requestAnimationFrame(tick);
    return () => {
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
    };
  }, [isPlaying, attempt, profile]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !attempt || !profile) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);
    
    // Find nearest ghost frame
    let ghostFrame = profile.frames[0];
    let minGhostDiff = Infinity;
    const playbackMod = currentTime % profile.duration;
    for (const f of profile.frames) {
      const diff = Math.abs(f.timestamp - playbackMod);
      if (diff < minGhostDiff) {
        minGhostDiff = diff;
        ghostFrame = f;
      }
    }
    
    // Find nearest live frame
    let liveFrame = attempt.frames[0];
    let minLiveDiff = Infinity;
    for (const f of attempt.frames) {
      const diff = Math.abs(f.timestamp - currentTime);
      if (diff < minLiveDiff) {
        minLiveDiff = diff;
        liveFrame = f;
      }
    }
    
    let currentScore = 100;
    let currentWorkerScore = null;
    let minScoreDiff = Infinity;
    for (const s of attempt.scores) {
      const diff = Math.abs(s.timestamp - currentTime);
      if (diff < minScoreDiff) {
        minScoreDiff = diff;
        currentScore = s.score.overallScore;
        currentWorkerScore = s.score;
      }
    }
    
    // Render Particles
    updateAndDrawParticles(ctx);
    
    if (ghostFrame && ghostFrame.landmarks.length > 0) {
      ghostFrame.landmarks.forEach(handLandmarks => {
        renderGhostHand(ctx, handLandmarks, canvas.width, canvas.height, currentScore, ghostFrame.poseLandmarks?.[0]);
      });
    }
    
    if (liveFrame && liveFrame.landmarks.length > 0) {
      liveFrame.landmarks.forEach(handLandmarks => {
        renderLiveHand(ctx, handLandmarks, canvas.width, canvas.height, liveFrame.poseLandmarks?.[0]);
      });
      
      // Biomechanical Stress Heatmap overlay
      if (currentWorkerScore && currentScore < 70) {
        // Find worst finger
        const fingers = Object.entries(currentWorkerScore.fingerScores);
        fingers.sort((a, b) => a[1] - b[1]);
        const worstFinger = fingers[0];
        
        if (worstFinger[1] < 50) {
          // Map finger name to tip index
          const tipMap: Record<string, number> = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
          const idx = tipMap[worstFinger[0]];
          
          if (idx !== undefined) {
             const lx = liveFrame.landmarks[0][idx].x * canvas.width;
             const ly = liveFrame.landmarks[0][idx].y * canvas.height;
             
             ctx.save();
             ctx.beginPath();
             ctx.arc(lx, ly, 25, 0, 2 * Math.PI);
             ctx.fillStyle = 'rgba(239, 68, 68, 0.4)'; // Red pulse
             ctx.fill();
             ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
             ctx.lineWidth = 2;
             ctx.stroke();
             ctx.restore();
          }
        }
      }
    }
    
    ctx.restore();
  }, [currentTime, attempt, profile]);

  if (!attempt || !profile) return null;

  const chartData = attempt.scores.map(s => ({
    time: s.timestamp,
    score: s.score.overallScore,
  }));

  // Auto-generate Coaching Insight
  const avgScore = attempt.scores.reduce((acc, s) => acc + s.score.overallScore, 0) / (attempt.scores.length || 1);
  const minScore = Math.min(...attempt.scores.map(s => s.score.overallScore));
  let insight = "Motion trajectory aligns well with expert baseline. Maintain current kinematic pacing.";
  if (avgScore < 70) {
    insight = "Consistent spatial deviation detected. Focus on matching structural wrist alignment before increasing speed.";
  } else if (minScore < 40) {
    insight = "Sharp deviation spike detected mid-sequence. Suggests temporal lag or structural overextension in a specific joint.";
  }

  return (
    <div className="flex-1 flex flex-col h-screen p-6 max-w-[1600px] mx-auto w-full gap-4">
      {/* Header */}
      <header className="flex justify-between items-center bg-surface/50 border border-white/5 rounded-xl px-6 py-4 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <button 
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            onClick={() => setAppState('SESSION')}
          >
            <ChevronLeft size={20} className="text-text-muted" />
          </button>
          <h2 className="text-lg font-medium tracking-wide">POST-SESSION KINEMATIC ANALYSIS</h2>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex gap-4 h-[calc(100vh-140px)]">
        
        {/* Left: Replay Canvas */}
        <div className="flex-[2] relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-black" ref={containerRef}>
          <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-10" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900/40 via-black to-black z-0" />
          
          {/* Controls overlay */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 panel px-6 py-3">
            <button 
              className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
              onClick={() => {
                if (currentTime >= attempt.duration) setCurrentTime(0);
                setIsPlaying(!isPlaying);
              }}
            >
              {isPlaying ? <Pause size={20} className="fill-white" /> : <Play size={20} className="fill-white" />}
            </button>
            <div className="text-sm font-mono text-text-muted w-20 text-center">
              {(currentTime / 1000).toFixed(1)}s / {(attempt.duration / 1000).toFixed(1)}s
            </div>
          </div>
        </div>

        {/* Right: Analytics */}
        <div className="flex-1 flex flex-col gap-4">
          
          <div className="panel p-6 flex flex-col gap-2">
            <h3 className="text-xs text-text-muted font-mono tracking-widest border-b border-white/10 pb-2">GLOBAL MATCH METRIC</h3>
            <div className={`text-5xl font-mono font-semibold ${avgScore > 80 ? 'text-accent' : avgScore > 50 ? 'text-yellow-400' : 'text-red-500'}`}>
              {avgScore.toFixed(1)}<span className="text-2xl ml-1 text-white/30">%</span>
            </div>
          </div>

          <div className="panel p-6 flex-1 flex flex-col gap-4">
             <h3 className="text-xs text-text-muted font-mono tracking-widest border-b border-white/10 pb-2">DEVIATION PROFILER</h3>
             <div className="flex-1 min-h-[200px]">
               <ResponsiveContainer width="100%" height="100%">
                 <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                   <XAxis dataKey="time" hide />
                   <YAxis domain={[0, 100]} stroke="#333" tick={{ fill: '#666', fontSize: 10 }} />
                   <Tooltip 
                     contentStyle={{ backgroundColor: '#171717', borderColor: '#333', color: '#fff', fontSize: '12px', fontFamily: 'monospace' }}
                     labelFormatter={() => ''}
                   />
                   <ReferenceLine x={currentTime} stroke="#06b6d4" strokeDasharray="3 3" />
                   <Line type="monotone" dataKey="score" stroke="#06b6d4" strokeWidth={2} dot={false} isAnimationActive={false} />
                 </LineChart>
               </ResponsiveContainer>
             </div>
          </div>

          <div className="panel p-6 flex flex-col gap-2">
             <h3 className="text-xs text-text-muted font-mono tracking-widest border-b border-white/10 pb-2">DETERMINISTIC INSIGHT</h3>
             <p className="text-sm text-text-main leading-relaxed">
               {insight}
             </p>
          </div>

        </div>
      </div>
    </div>
  );
};
