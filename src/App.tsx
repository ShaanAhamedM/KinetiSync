import { motion, AnimatePresence } from 'framer-motion';
import { CameraView } from './components/CameraView';
import { ReplayView } from './components/ReplayView';
import { useAppStore } from './store/useAppStore';
import { Activity, Power, Upload } from 'lucide-react';
import { useRef } from 'react';

function App() {
  const appState = useAppStore(state => state.appState);
  const setAppState = useAppStore(state => state.setAppState);
  const setUploadedVideoUrl = useAppStore(state => state.setUploadedVideoUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setUploadedVideoUrl(url);
      setAppState('VIDEO_PROCESS');
    }
  };

  return (
    <div className="w-full min-h-screen bg-base text-text-main flex flex-col font-sans">
      <AnimatePresence mode="wait">
        {appState === 'LANDING' && (
          <motion.div
            key="landing"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex-1 flex flex-col items-center justify-center max-w-7xl mx-auto w-full px-8 gap-12"
          >
            <div className="text-center space-y-4">
              <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-accent/10 text-accent text-sm font-mono border border-accent/20 mb-4">
                <Activity size={16} />
                <span>CLINICAL KINEMATIC ENGINE v2.0</span>
              </div>
              <h1 className="text-6xl font-semibold tracking-tight">Osmosis</h1>
              <p className="text-xl text-text-muted max-w-2xl mx-auto leading-relaxed">
                Precision motor-skill transfer via dynamic time warping and real-time spatial path diffing.
              </p>
            </div>
            
            <div className="panel p-10 flex flex-col items-center gap-8 w-full max-w-md">
              <div className="space-y-2 text-center">
                <h2 className="text-2xl font-medium text-white">System Standby</h2>
                <p className="text-sm text-text-muted">Initialize calibration and tracking sequence.</p>
              </div>
              
              <button 
                className="w-full btn-primary flex items-center justify-center gap-2 group" 
                onClick={() => setAppState('SESSION')}
              >
                <Power size={18} className="group-hover:text-white transition-colors" />
                INITIALIZE SESSION
              </button>
              
              <div className="relative w-full">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10" />
                </div>
                <div className="relative flex justify-center text-xs font-mono tracking-widest">
                  <span className="bg-[#18181b] px-2 text-white/30">OR</span>
                </div>
              </div>

              <input 
                type="file" 
                accept="video/mp4,video/webm" 
                ref={fileInputRef}
                className="hidden"
                onChange={handleVideoUpload}
              />
              <button 
                className="w-full btn-secondary flex items-center justify-center gap-2" 
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={18} className="text-accent" />
                UPLOAD EXPERT VIDEO
              </button>
            </div>
          </motion.div>
        )}

        {(appState === 'SESSION' || appState === 'VIDEO_PROCESS') && (
          <motion.div
            key="session"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 flex flex-col h-screen p-6 max-w-[1600px] mx-auto w-full gap-4"
          >
            {/* Top Navigation Bar */}
            <header className="flex justify-between items-center bg-surface/50 border border-white/5 rounded-xl px-6 py-4 backdrop-blur-md">
              <div className="flex items-center gap-4">
                <div className="w-3 h-3 rounded-full bg-accent animate-pulse shadow-[0_0_10px_rgba(6,182,212,0.5)]" />
                <h2 className="text-lg font-medium tracking-wide">
                  {appState === 'VIDEO_PROCESS' ? 'EXPERT VIDEO PROCESSING' : 'ACTIVE TRACKING SESSION'}
                </h2>
              </div>
              <button 
                className="btn-secondary text-sm px-4 py-2 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all"
                onClick={() => {
                  setAppState('LANDING');
                  setUploadedVideoUrl(null);
                }}
              >
                TERMINATE SESSION
              </button>
            </header>

            {/* Main Workspace */}
            <main className="flex-1 relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-black">
               <CameraView />
            </main>
          </motion.div>
        )}

        {appState === 'REPLAY' && (
          <motion.div
            key="replay"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="w-full h-screen"
          >
            <ReplayView />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
