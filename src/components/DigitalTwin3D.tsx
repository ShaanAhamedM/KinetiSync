import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Grid } from '@react-three/drei';
import { use3DStore } from '../store/use3DStore';
import { HandMesh3D } from './HandMesh3D';
import * as THREE from 'three';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

const TensionLineObj = ({ liveLm, ghostLm, aspectRatio }: { liveLm: NormalizedLandmark, ghostLm: NormalizedLandmark, aspectRatio: number }) => {
  const objRef = React.useRef({
    p1: new THREE.Vector3(),
    p2: new THREE.Vector3(),
    color: new THREE.Color(),
    colorA: new THREE.Color('#fbbf24'),
    colorB: new THREE.Color('#ef4444'),
    pos: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    up: new THREE.Vector3(0, 1, 0)
  });

  const { p1, p2, color, colorA, colorB, pos, dir, quat, up } = objRef.current;

  p1.set(-(liveLm.x - 0.5) * 6 * aspectRatio, -(liveLm.y - 0.5) * 6, -liveLm.z * 6);
  p2.set(-(ghostLm.x - 0.5) * 6 * aspectRatio, -(ghostLm.y - 0.5) * 6, -ghostLm.z * 6);
  
  const dist = p1.distanceTo(p2);
  if (dist < 0.2) return null;

  color.lerpColors(colorA, colorB, Math.min(1, (dist - 0.2) / 1.0));
  pos.copy(p1).lerp(p2, 0.5);
  dir.copy(p2).sub(p1).normalize();
  
  if (dir.lengthSq() > 0.0001) {
    quat.setFromUnitVectors(up, dir);
  }

  // Use getHex() and arrays to prevent object allocations on render (BUG-40)
  return (
    <mesh position={[pos.x, pos.y, pos.z]} quaternion={[quat.x, quat.y, quat.z, quat.w]}>
       <cylinderGeometry args={[0.02, 0.02, dist, 8]} />
       <meshBasicMaterial color={color.getHex()} transparent opacity={0.6} />
    </mesh>
  );
};

const TensionLines = ({ live, ghost, aspectRatio }: { live: NormalizedLandmark[], ghost: NormalizedLandmark[], aspectRatio: number }) => {
  const tips = [4, 8, 12, 16, 20];
  
  return (
    <group>
      {tips.map(tip => (
        <TensionLineObj 
          key={`tension-${tip}`} 
          liveLm={live[tip]} 
          ghostLm={ghost[tip]} 
          aspectRatio={aspectRatio} 
        />
      ))}
    </group>
  );
};

const DigitalTwinScene = () => {
  const liveLandmarks = use3DStore(state => state.liveLandmarks);
  const ghostLandmarks = use3DStore(state => state.ghostLandmarks);
  const cardboardLandmarks = use3DStore(state => state.cardboardLandmarks);
  const dtwScores = use3DStore(state => state.dtwScores);
  const aspectRatio = use3DStore(state => state.aspectRatio);
  const cardboardAspectRatio = use3DStore(state => state.cardboardAspectRatio);

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

      {/* Cardboard Hand (hardware feedback, tracked via the Camo phone camera) */}
      {cardboardLandmarks && cardboardLandmarks.map((hand, idx) => (
        <HandMesh3D
          key={`cardboard-${idx}`}
          landmarks={hand}
          isExpert={false}
          colorOverride="#f97316"
          aspectRatio={cardboardAspectRatio}
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
