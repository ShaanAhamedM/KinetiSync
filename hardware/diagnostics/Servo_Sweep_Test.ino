// STEP 2 DIAGNOSTIC: Confirms PCA9685 + power + servo wiring work end-to-end,
// completely independent of the website/WebSerial/Arduino serial parsing.
//
// Run this AFTER I2C_Scanner.ino finds the PCA9685 at 0x40.
// No computer connection needed after upload - this runs standalone off
// USB or your external 5V supply and sweeps all 5 channels back and forth.
//
// If servos move here but NOT from the website: the hardware is fine,
// the bug is in the serial link between the browser and the Arduino
// (see the LED heartbeat added to KinetiSync_ArduinoUNO.ino).
//
// If servos DON'T move here: it's wiring/power, not software. Check:
//  - External 5V supply actually connected to PCA9685 V+ terminal (not just VCC)
//  - External supply GND connected to Arduino GND (shared ground - very commonly missed)
//  - Signal wire (orange/yellow) in the TOP row, not swapped with GND row
//  - Servo actually seated in channels 0-4

#include <Adafruit_PWMServoDriver.h>
#include <Wire.h>

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver();

#define SERVOMIN 150
#define SERVOMAX 600
#define SERVO_FREQ 50
#define NUM_SERVOS 5

int angleToPulse(int angle) {
  return map(angle, 0, 180, SERVOMIN, SERVOMAX);
}

void setup() {
  Serial.begin(115200);
  Serial.println("Servo Sweep Test starting...");

  pwm.begin();
  pwm.setOscillatorFrequency(27000000);
  pwm.setPWMFreq(SERVO_FREQ);
  delay(10);
}

void loop() {
  Serial.println("Sweep: 0 -> 180");
  for (int angle = 0; angle <= 180; angle += 5) {
    for (int ch = 0; ch < NUM_SERVOS; ch++) {
      pwm.setPWM(ch, 0, angleToPulse(angle));
    }
    delay(30);
  }

  delay(500);

  Serial.println("Sweep: 180 -> 0");
  for (int angle = 180; angle >= 0; angle -= 5) {
    for (int ch = 0; ch < NUM_SERVOS; ch++) {
      pwm.setPWM(ch, 0, angleToPulse(angle));
    }
    delay(30);
  }

  delay(500);
}
