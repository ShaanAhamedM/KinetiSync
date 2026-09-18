import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

interface SerialPort {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array>;
}

declare global {
  interface Navigator {
    serial: {
      requestPort(): Promise<SerialPort>;
    };
  }
}

export class HardwareBridge {
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  public isConnected: boolean = false;

  async connect() {
    if (!('serial' in navigator)) {
      console.warn('WebSerial API not supported in this browser.');
      return false;
    }

    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 });
      this.writer = this.port.writable?.getWriter() ?? null;
      this.isConnected = true;
      console.log('Hardware connected successfully via WebSerial');
      return true;
    } catch (e) {
      console.error('Failed to connect to hardware:', e);
      this.isConnected = false;
      return false;
    }
  }

  async disconnect() {
    if (this.writer) {
      await this.writer.close();
      this.writer = null;
    }
    if (this.port) {
      await this.port.close();
      this.port = null;
    }
    this.isConnected = false;
  }

  // Convert MediaPipe landmarks to 5 servo angles (0-180 degrees)
  calculateAngles(landmarks: NormalizedLandmark[]): number[] {
    if (landmarks.length < 21) return [90, 90, 90, 90, 90];

    // Helper: calculate distance between two 3D points
    const dist = (p1: NormalizedLandmark, p2: NormalizedLandmark) => 
      Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2 + (p1.z - p2.z)**2);

    const palm = landmarks[0];
    
    // Normalize mapping: max distance = straight (0 deg), min distance = curled (180 deg)
    const mapToAngle = (distance: number, min: number, max: number) => {
       const clamped = Math.max(min, Math.min(max, distance));
       const percentage = 1 - ((clamped - min) / (max - min));
       return Math.round(percentage * 180);
    };

    const thumbAngle = mapToAngle(dist(landmarks[4], landmarks[17]), 0.1, 0.4);
    const indexAngle = mapToAngle(dist(landmarks[8], palm), 0.1, 0.5);
    const middleAngle = mapToAngle(dist(landmarks[12], palm), 0.1, 0.5);
    const ringAngle = mapToAngle(dist(landmarks[16], palm), 0.1, 0.5);
    const pinkyAngle = mapToAngle(dist(landmarks[20], palm), 0.1, 0.5);

    return [thumbAngle, indexAngle, middleAngle, ringAngle, pinkyAngle];
  }

  async sendAngles(angles: number[]) {
    // Format: "thumb,index,middle,ring,pinky\n"
    const dataString = angles.join(',') + '\n';

    if (this.isConnected && this.writer) {
      try {
        const encoder = new TextEncoder();
        await this.writer.write(encoder.encode(dataString));
      } catch (e) {
        console.error("Hardware transmission error:", e);
      }
    }
  }
}

export const hardwareBridge = new HardwareBridge();
