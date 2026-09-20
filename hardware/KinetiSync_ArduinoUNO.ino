#include <Adafruit_PWMServoDriver.h>
#include <Wire.h>

// Called this way, it uses the default address 0x40
Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver();

// Depending on your servo make, the pulse width min and max may vary.
// SG90 servos usually work well between 150 (0 deg) and 600 (180 deg).
#define SERVOMIN 150  // This is the 'minimum' pulse length count (out of 4096)
#define SERVOMAX 600  // This is the 'maximum' pulse length count (out of 4096)
#define SERVO_FREQ 50 // Analog servos run at ~50 Hz updates

// Buffer for incoming serial data from WebSerial
String inputString = "";
bool stringComplete = false;

void setup() {
  // Must match the baud rate in hardwareBridge.ts (115200)
  Serial.begin(115200);

  // Onboard LED toggles every time a full line is parsed - this is a visual
  // heartbeat you can watch to confirm the browser's WebSerial writes are
  // actually reaching the Arduino, even when Serial Monitor can't be open
  // at the same time (only one program can hold the port).
  pinMode(LED_BUILTIN, OUTPUT);

  // Initialize the I2C communication and PCA9685
  pwm.begin();
  pwm.setOscillatorFrequency(27000000);
  pwm.setPWMFreq(SERVO_FREQ);

  // Allow time to initialize
  delay(10);

  Serial.println("KinetiSync Arduino UNO Ready. Waiting for motor angles...");
}

void loop() {
  // Read Serial data from the WebSerial API
  while (Serial.available()) {
    char inChar = (char)Serial.read();
    inputString += inChar;
    if (inChar == '\n') {
      stringComplete = true;
    }
  }

  // If a full string is received (e.g., "90,45,180,0,90\n")
  if (stringComplete) {
    parseAndMoveServos(inputString);
    inputString = "";
    stringComplete = false;
  }
}

void parseAndMoveServos(String data) {
  // We expect 5 values separated by commas: Thumb, Index, Middle, Ring, Pinky
  int angles[5];
  int commaIndex = -1;

  for (int i = 0; i < 5; i++) {
    int nextComma = data.indexOf(',', commaIndex + 1);

    String valString = "";
    if (nextComma != -1) {
      valString = data.substring(commaIndex + 1, nextComma);
    } else {
      // Last value
      valString = data.substring(commaIndex + 1);
    }

    angles[i] = valString.toInt();
    // Clamp the angle between 0 and 180 for safety
    angles[i] = constrain(angles[i], 0, 180);

    // Map the 0-180 degree angle to PCA9685 pulse lengths.
    // NORMAL: 0 degrees -> SERVOMIN, 180 degrees -> SERVOMAX
    // (Flipped from the previous inverted mapping: the cardboard hand was
    // closing when the human hand opened.)
    int pulse = map(angles[i], 0, 180, SERVOMIN, SERVOMAX);

    // Drive the servo on channels 0 through 4
    pwm.setPWM(i, 0, pulse);

    commaIndex = nextComma;
  }

  // Toggle heartbeat LED so you can SEE data arriving from the browser
  digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
}
