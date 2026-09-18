import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Grid } from '@react-three/drei';
import { use3DStore } from '../store/use3DStore';
import { HandMesh3D } from './HandMesh3D';
import * as THREE from 'three';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

const TensionLines = ({ live, ghost, aspectRatio }: { live: NormalizedLandmark[], ghost: NormalizedLandmark[], aspectRatio: number }) => {
  const getVector = (lm: NormalizedLandmark) => new THREE.Vector3(
    -(lm.x - 0.5) * 6 * aspectRatio,
    -(lm.y - 0.5) * 6,
    -lm.z * 6
  );

  const tips = [4, 8, 12, 16, 20];
  
  return (
    <group>
      {tips.map(tip => {
        const p1 = getVector(live[tip]);
        const p2 = getVector(ghost[tip]);
        const dist = p1.distanceTo(p2);
        
        if (dist < 0.2) return null; // No tension if perfectly aligned

        const color = new THREE.Color().lerpColors(
          new THREE.Color('#fbbf24'),
          new THREE.Color('#ef4444'),
          Math.min(1, (dist - 0.2) / 1.0)
        );

        const pos = p1.clone().lerp(p2, 0.5);
        const dir = p2.clone().sub(p1).normalize();
        const quat = new THREE.Quaternion();
        if (dir.lengthSq() > 0.0001) {
           quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        }

        return (
          <mesh key={`tension-${tip}`} position={pos} quaternion={quat}>
             <cylinderGeometry args={[0.02, 0.02, dist, 8]} />
             <meshBasicMaterial color={color} transparent opacity={0.6} />
          </mesh>
        );
      })}
    </group>
  );
};

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

      {/* Tension Lines for Deviation */}
      {liveLandmarks && liveLandmarks[0] && ghostLandmarks && ghostLandmarks[0] && (
        <TensionLines live={liveLandmarks[0]} ghost={ghostLandmarks[0]} aspectRatio={aspectRatio} />
      )}
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
