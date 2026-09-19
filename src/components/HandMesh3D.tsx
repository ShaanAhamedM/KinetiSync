import React, { useMemo } from 'react';
import * as THREE from 'three';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

interface HandMesh3DProps {
  landmarks: NormalizedLandmark[];
  isExpert?: boolean;
  fingerScores?: {
    thumb: number;
    index: number;
    middle: number;
    ring: number;
    pinky: number;
  } | null;
  aspectRatio?: number;
  // Forces a fixed color for every joint/bone, bypassing score-based coloring
  // (used for the cardboard hand's hardware feedback twin).
  colorOverride?: string;
}

// MediaPipe Hand Connection Graph
const HAND_CONNECTIONS = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [5, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [9, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
];

// Helper to get color based on score
const getScoreColor = (score: number | undefined, isExpert: boolean) => {
  if (isExpert) return '#06b6d4'; // Glowing cyan for expert
  if (score === undefined) return '#ffffff';
  if (score > 80) return '#06b6d4'; // Cyan
  if (score > 50) return '#fbbf24'; // Yellow
  return '#ef4444'; // Red
};

// Maps MediaPipe joint index to a finger name
const getFingerFromJoint = (index: number) => {
  if (index >= 1 && index <= 4) return 'thumb';
  if (index >= 5 && index <= 8) return 'index';
  if (index >= 9 && index <= 12) return 'middle';
  if (index >= 13 && index <= 16) return 'ring';
  if (index >= 17 && index <= 20) return 'pinky';
  return 'palm';
};

const Bone = ({ start, end, color, radius = 0.15, isExpert = false }: { start: THREE.Vector3, end: THREE.Vector3, color: string, radius?: number, isExpert?: boolean }) => {
  const distance = start.distanceTo(end);
  const position = start.clone().lerp(end, 0.5);
  
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const dir = end.clone().sub(start).normalize();
  if (dir.lengthSq() > 0.0001) {
    quaternion.setFromUnitVectors(up, dir);
  }

  return (
    <mesh position={position} quaternion={quaternion}>
      {isExpert ? (
        <capsuleGeometry args={[radius, distance, 16, 32]} />
      ) : (
        <cylinderGeometry args={[radius * 0.8, radius * 0.8, distance, 6]} />
      )}
      <meshPhysicalMaterial 
        color={color} 
        emissive={color} 
        emissiveIntensity={isExpert ? 0.3 : 0.1} 
        roughness={isExpert ? 0.1 : 0.6} 
        metalness={isExpert ? 0.5 : 0.9} 
        transmission={isExpert ? 0.4 : 0.0}
        thickness={0.5}
        transparent={isExpert}
        opacity={isExpert ? 0.8 : 1}
      />
    </mesh>
  );
};

const Joint = ({ position, color, radius = 0.16, isExpert = false }: { position: THREE.Vector3, color: string, radius?: number, isExpert?: boolean }) => {
  return (
    <mesh position={position}>
      {isExpert ? (
        <sphereGeometry args={[radius, 32, 32]} />
      ) : (
        <boxGeometry args={[radius * 1.5, radius * 1.5, radius * 1.5]} />
      )}
      <meshPhysicalMaterial 
        color={color} 
        emissive={color} 
        emissiveIntensity={isExpert ? 0.4 : 0.2}
        roughness={isExpert ? 0.1 : 0.4}
        metalness={isExpert ? 0.5 : 0.9}
        transmission={isExpert ? 0.4 : 0.0}
        thickness={0.5}
        transparent={isExpert}
        opacity={isExpert ? 0.8 : 1}
      />
    </mesh>
  );
};

export const HandMesh3D: React.FC<HandMesh3DProps> = ({ landmarks, isExpert = false, fingerScores = null, aspectRatio = 1, colorOverride }) => {
  // Convert MediaPipe landmarks (normalized 0-1) to ThreeJS World Space (-3 to 3 approx)
  const vectors = useMemo(() => {
    return landmarks.map(lm => {
      // Multiply X by aspect ratio to fix stretching on non-square video feeds (like mobile)
      return new THREE.Vector3(
        -(lm.x - 0.5) * 6 * aspectRatio, // Flipped X to match mirror video
        -(lm.y - 0.5) * 6,
        -lm.z * 6
      );
    });
  }, [landmarks, aspectRatio]);

  return (
    <group>
      {/* Render Joints */}
      {vectors.map((v, i) => {
        const finger = getFingerFromJoint(i);
        const score = fingerScores ? fingerScores[finger as keyof typeof fingerScores] : undefined;
        const color = colorOverride ?? getScoreColor(score, isExpert);
        
        // Make palm base joints slightly thicker
        const radius = (i === 0 || i === 1 || i === 5 || i === 9 || i === 13 || i === 17) ? 0.22 : 0.16;
        
        return <Joint key={`joint-${i}`} position={v} color={color} radius={radius} isExpert={isExpert} />;
      })}

      {/* Render Bones */}
      {HAND_CONNECTIONS.map((connection, idx) => {
        const startIdx = connection[0];
        const endIdx = connection[1];
        
        const finger = getFingerFromJoint(endIdx);
        const score = fingerScores ? fingerScores[finger as keyof typeof fingerScores] : undefined;
        const color = colorOverride ?? getScoreColor(score, isExpert);
        
        // Thicker bones for the palm area, tapering for fingers
        const radius = (startIdx === 0 || endIdx === 0 || endIdx === 1 || endIdx === 5 || endIdx === 9 || endIdx === 13 || endIdx === 17) ? 0.2 : 0.14;
        
        return (
          <Bone 
            key={`bone-${idx}`} 
            start={vectors[startIdx]} 
            end={vectors[endIdx]} 
            color={color}
            radius={radius}
            isExpert={isExpert}
          />
        );
      })}

      {/* Additional Palm Webbing (Connecting Knuckles) */}
      {[
        [1, 5], [5, 9], [9, 13], [13, 17]
      ].map((conn, idx) => (
        <Bone 
          key={`webbing-${idx}`} 
          start={vectors[conn[0]]}
          end={vectors[conn[1]]}
          color={colorOverride ?? (isExpert ? '#06b6d4' : '#ffffff')}
          radius={0.2}
          isExpert={isExpert}
        />
      ))}
    </group>
  );
};
