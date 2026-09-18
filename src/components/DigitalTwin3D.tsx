import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Grid } from '@react-three/drei';
import { use3DStore } from '../store/use3DStore';
import { HandMesh3D } from './HandMesh3D';

const DigitalTwinScene = () => {
  const liveLandmarks = use3DStore(state => state.liveLandmarks);
  const ghostLandmarks = use3DStore(state => state.ghostLandmarks);
  const dtwScores = use3DStore(state => state.dtwScores);
  const aspectRatio = use3DStore(state => state.aspectRatio);

  return (
    <>
      <OrbitControls 
        enablePan={true} 
        enableZoom={true} 
        enableRotate={true}
        autoRotate={false}
        autoRotateSpeed={1}
      />
      
      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1.5} color="#ffffff" />
      <pointLight position={[-10, -10, -10]} intensity={1} color="#06b6d4" />
      
      <Environment preset="city" />

      {/* Cybernetic Floor Grid */}
      <Grid 
        renderOrder={-1} 
        position={[0, -2, 0]} 
        infiniteGrid 
        fadeDistance={20} 
        fadeStrength={5} 
        cellColor="#06b6d4" 
        sectionColor="#06b6d4" 
        cellThickness={0.5} 
        sectionThickness={1} 
      />

      {/* Trainee Live Hands */}
      {liveLandmarks && liveLandmarks.map((hand, idx) => (
        <HandMesh3D 
          key={`live-${idx}`} 
          landmarks={hand} 
          isExpert={false}
          fingerScores={dtwScores?.fingerScores}
          aspectRatio={aspectRatio}
        />
      ))}

      {/* Expert Ghost Hands */}
      {ghostLandmarks && ghostLandmarks.map((hand, idx) => (
        <HandMesh3D 
          key={`ghost-${idx}`} 
          landmarks={hand} 
          isExpert={true}
          aspectRatio={aspectRatio}
        />
      ))}
    </>
  );
};

export const DigitalTwin3D: React.FC = () => {
  return (
    <div className="w-full h-full bg-transparent">
      <Canvas 
        camera={{ position: [0, 0, 5], fov: 50 }}
        gl={{ alpha: true, antialias: true }}
      >
        <Suspense fallback={null}>
          <DigitalTwinScene />
        </Suspense>
      </Canvas>
    </div>
  );
};
