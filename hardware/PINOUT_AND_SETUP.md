# KinetiSync Hardware Setup Guide

This folder contains everything you need to connect your Arduino UNO, PCA9685, and 5 SG90 Servo Motors to the KinetiSync Web Platform.

## 🛠️ Required Components
1. **Arduino UNO Microcontroller**
2. **PCA9685 16-Channel 12-bit PWM/Servo Driver**
3. **5x SG90 Micro Servos** (for the cardboard hand)
4. **5V Power Supply / Battery Pack** *(DO NOT power 5 servos directly from the Arduino! It will fry it or cause brownouts).*
5. **Jumper Wires**

---

## ⚡ Pinout Connections

### 1. Arduino UNO to PCA9685 (I2C Communication)
The PCA9685 communicates with the Arduino UNO via I2C (SDA and SCL pins).

| PCA9685 Pin | Arduino UNO Pin | Description |
| :--- | :--- | :--- |
| **VCC** | **5V** | Logic power for the PCA9685 chip itself |
| **GND** | **GND** | Logic ground |
| **SDA** | **A4** | I2C Data |
| **SCL** | **A5** | I2C Clock |

### 2. Powering the PCA9685 Motors (V+ Terminal)
Servos draw a lot of current. You must connect an external 5V power supply to the green terminal block on the PCA9685.
- **V+ Terminal:** Connect to 5V Positive from your battery/supply.
- **GND Terminal:** Connect to Ground from your battery/supply.
*(Note: Make sure the grounds of your external supply and the Arduino are connected together!)*

### 3. Servos to PCA9685
Plug your 5 servos into the yellow/red/brown headers on the PCA9685. Pay attention to the colors:
- **Brown Wire:** Ground (Bottom row)
- **Red Wire:** V+ (Middle row)
- **Orange/Yellow Wire:** PWM Signal (Top row)

Plug them in this exact order so they match the website's output:
- **Channel 0:** Thumb Servo
- **Channel 1:** Index Finger Servo
- **Channel 2:** Middle Finger Servo
- **Channel 3:** Ring Finger Servo
- **Channel 4:** Pinky Finger Servo

---

## 💻 Flashing the Code

1. Open `KinetiSync_ArduinoUNO.ino` in the Arduino IDE.
2. Go to **Sketch > Include Library > Manage Libraries**.
3. Search for and install **"Adafruit PWM Servo Driver Library"**.
4. Select your **Arduino UNO** board and COM port.
5. Hit **Upload**.

---

## 🚀 How to Test It With the Website

1. Keep the Arduino UNO plugged into your laptop via USB.
2. Open the KinetiSync React App (`npm run dev`) in Google Chrome.
3. On the right side of the UI, click the **"CONNECT HARDWARE (SERIAL)"** button.
4. A browser popup will appear. Select your Arduino's USB port (e.g., `USB Serial` or `usbmodem`).
5. Move your hand in front of the webcam. The MediaPipe AI will instantly extract your finger angles, send them over the USB cable, and your cardboard hand will move in real-time!
