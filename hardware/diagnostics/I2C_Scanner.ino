// STEP 1 DIAGNOSTIC: Confirms the Arduino can actually "see" the PCA9685 over I2C.
// Upload this FIRST, before touching servos. Open Serial Monitor at 115200 baud.
//
// Why: the main KinetiSync sketch prints "Ready" as soon as Serial starts —
// that message does NOT prove the PCA9685 is wired correctly, because the
// Adafruit library doesn't check for an I2C ack on begin(). This scanner
// does a real bus scan and will only report an address if a device answers.
//
// Expected result: "Device found at 0x40" (PCA9685 default address).
// If it prints "No I2C devices found", the problem is your SDA/SCL wiring
// (swapped A4/A5, loose jumper, or no shared ground) - fix that before
// anything else will work.

#include <Wire.h>

void setup() {
  Wire.begin();
  Serial.begin(115200);
  while (!Serial) { delay(10); }
  delay(500);
  Serial.println("\nI2C Scanner starting...");
}

void loop() {
  int devicesFound = 0;

  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    byte error = Wire.endTransmission();

    if (error == 0) {
      Serial.print("Device found at 0x");
      if (address < 16) Serial.print("0");
      Serial.println(address, HEX);
      devicesFound++;
    }
  }

  if (devicesFound == 0) {
    Serial.println("No I2C devices found. Check SDA(A4)/SCL(A5) wiring and shared GND.");
  } else {
    Serial.print(devicesFound);
    Serial.println(" device(s) found. (PCA9685 default = 0x40)");
  }

  Serial.println("---");
  delay(3000);
}
