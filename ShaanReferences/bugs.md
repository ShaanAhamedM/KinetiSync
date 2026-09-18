# 🐛 Osmosis – Full Bug Report
> Auto-generated via code audit on 2026-09-13. Every file in `/src` was reviewed.

---

## 🔴 Critical / Functional Bugs

---

### BUG-01 · `useHandTracking` receives `null` on first render (Race Condition)
**File:** `src/components/CameraView.tsx`  
**Severity:** Critical  

`videoRef.current` is **always `null`** on the first render because the `<video>` element hasn't been mounted yet when this line executes:

```ts
const { isModelLoaded, setOnResults } = useHandTracking(videoRef.current);
```

The hook receives `null` as `videoElement`, sets up the detection loop against it, and never retries — so **hand tracking never starts** unless the video element is already in the DOM when the hook is first called.

**Root Cause:** `useHandTracking`'s second `useEffect` has `[handLandmarker, videoElement]` as deps, but `videoElement` is captured by value at render time (which is `null`), not reactively via a ref.

**Fix:** Pass `videoRef` (the ref object itself) into the hook, not `videoRef.current`. Inside the hook, read `videoRef.current` inside the effect so it resolves after mount.

---

### BUG-02 · `setOnResults` is NOT memoized — causes infinite re-render loop
**File:** `src/hooks/useHandTracking.ts`  
**Severity:** Critical  

`setOnResults` is re-created on every render since it's a plain function in the hook body (not `useCallback`). `CameraView` uses it in a `useEffect` dependency array:

```ts
useEffect(() => {
  setOnResults(...)
}, [setOnResults, isRecording, isPlaying, savedProfile]);
```

Every re-render → new `setOnResults` ref → effect re-runs → state may be set → another render → **infinite loop**.

**Fix:** Wrap `setOnResults` in `useCallback` with an empty dependency array inside the hook.

---

### BUG-03 · Recording can silently save **zero frames** with no user feedback
**File:** `src/components/CameraView.tsx` – `handleStopRecording`  
**Severity:** Critical  

If the user clicks "Stop Recording" before the model loads or a hand is detected, `recordedFramesRef.current` is empty. The guard prevents saving — **but there is zero user-facing feedback**. The user sees nothing and will be confused next session.

Additionally, if `savedProfile.duration` were somehow `0`, `playbackTime % 0 === NaN` → all landmark comparisons break.

**Fix:** Show a UI notification ("No hand detected during recording") when frames are empty on stop.

---

### BUG-04 · `HandLandmarker` is never closed/disposed — GPU memory leak
**File:** `src/hooks/useHandTracking.ts`  

The comment says:
```ts
// We don't eagerly close it here to avoid issues with hot reloading,
// but in production we might want to call landmarker.close()...
```

The `HandLandmarker` WebAssembly/WebGL object is **never disposed**. When the component unmounts (user clicks "End Session"), GPU resources keep running. In long sessions or repeated navigation, this causes GPU memory exhaustion.

**Fix:** Call `landmarker.close()` in the useEffect cleanup. Handle hot-reload with a separate flag.

---

### BUG-05 · `requestAnimationFrame` loop is not cancelled when `videoElement` changes
**File:** `src/hooks/useHandTracking.ts` – second `useEffect`  

The rAF loop captures `videoElement` in closure. If `videoElement` changes, the previous loop keeps running against the **stale old element** while a new loop also starts. Two concurrent detection loops can run simultaneously causing duplicate processing.

---

### BUG-06 · Canvas landmark coordinates misaligned due to `objectFit: cover`
**File:** `src/components/CameraView.tsx`  

```ts
canvas.width = video.clientWidth;
canvas.height = video.clientHeight;
```

The `<video>` uses `objectFit: cover`, meaning the actual rendered video frame is **cropped and scaled**. Landmark coordinates (normalized 0–1 against native stream resolution) are mapped to the element size without accounting for the crop offset. This causes **landmark drawings to be visually misaligned from the actual hand position**, especially when the camera aspect ratio differs from the container.

**Fix:** Use `videoWidth`/`videoHeight` to compute the proper scaling with cover-crop offset.

---

### BUG-07 · "Record Motion" and "Start Session" buttons do the exact same thing
**File:** `src/App.tsx`  

```tsx
<button className="btn-secondary" onClick={() => setAppState('SESSION')}>
  Record Motion
</button>
<button className="btn-primary" onClick={() => setAppState('SESSION')}>
  Start Session
</button>
```

Both buttons call `setAppState('SESSION')` with no distinction. The intent is presumably that one opens recording mode and one opens practice mode. **The UI is broken by design** — the secondary action does nothing different.

**Fix:** Pass a mode prop or set initial recording state based on which button was clicked.

---

### BUG-08 · `localStorage` profile is single-slot — silently overwrites previous recording
**File:** `src/components/CameraView.tsx` – `handleStopRecording`  

```ts
localStorage.setItem('osmosis_expert_profile', JSON.stringify(profile));
```

Only one profile can ever be saved. Every new recording **silently overwrites** the previous one with no warning or confirmation. A user who accidentally records a bad session immediately loses their good expert profile permanently.

---

### BUG-09 · Both `isRecording` and `isPlaying` can be true simultaneously
**File:** `src/components/CameraView.tsx`  

There is no mutex preventing a user from clicking "Play Ghost Hand" while recording is active (both buttons can be visible at the same time if a profile exists). With both states true simultaneously, both recording capture and ghost hand drawing execute in the same frame — potentially corrupting the recorded dataset.

---

### BUG-10 · `@latest` CDN URL for MediaPipe WASM is non-deterministic
**File:** `src/hooks/useHandTracking.ts`  

```ts
"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
```

Using `@latest` on a CDN means the loaded WASM binary can change any day without a code change. A breaking MediaPipe update will silently **crash the app for all users**.

**Fix:** Pin to the specific version matching the installed package (e.g. `@1.0.1`).

---

## 🟠 Moderate Bugs

---

### BUG-11 · `.text-muted` class is used but never defined in CSS
**File:** `src/index.css` / `src/App.tsx`  

`App.tsx` uses `className="text-muted"` but `index.css` only defines `--text-muted` as a CSS variable — there is **no `.text-muted` utility class**. The muted subtitle text on the landing page renders at full brightness instead of being muted.

**Fix:**
```css
.text-muted {
  color: var(--text-muted);
}
```

---

### BUG-12 · Canvas fades in before AI model finishes loading
**File:** `src/components/CameraView.tsx`  

```tsx
<canvas style={{ opacity: isReady ? 1 : 0 }} />
```

The canvas fades in when the camera is ready, but the model may still be loading. The canvas appears opaque over the video **showing nothing** for the full model load time (can be several seconds on slow connections).

**Fix:** `opacity: isReady && isModelLoaded ? 1 : 0`

---

### BUG-13 · `.camera-container` CSS class is used but never defined
**File:** `src/index.css` / `src/components/CameraView.tsx`  

`CameraView` uses `className="camera-container flex-center"` but `.camera-container` is not defined anywhere in the stylesheet. The layout relies entirely on inline styles making the class meaningless.

---

### BUG-14 · Ghost hand frame lookup is O(n) — performance bottleneck
**File:** `src/components/CameraView.tsx` – playback logic  

```ts
for (const frame of savedProfile.frames) { ... }
```

For a 30fps 10-second recording = 300 frames, this iterates all frames on **every animation frame** at 60fps = 18,000 iterations/second unnecessarily. 

**Fix:** Use binary search since frames are sorted by timestamp.

---

### BUG-15 · `icons.svg` in `/public` is never referenced — dead asset
**File:** `/public/icons.svg`  

The file `icons.svg` exists in `/public` but is never imported or referenced anywhere in the codebase. Dead weight.

---

### BUG-16 · Browser tab title is `vinhack` instead of `Osmosis`
**File:** `index.html`  

```html
<title>vinhack</title>
```

The app is clearly named "Osmosis" (used in UI and `localStorage` keys), but the browser tab shows `vinhack`. Looks unpolished and unprofessional.

---

### BUG-17 · Default Vite template assets never cleaned up
**File:** `src/assets/`  

`src/assets/hero.png`, `src/assets/react.svg`, and `src/assets/vite.svg` are default Vite template files that are never imported or used anywhere. Dead bundle weight.

---

### BUG-18 · No user-facing error if MediaPipe model fails to load
**File:** `src/hooks/useHandTracking.ts`  

```ts
} catch (error) {
  console.error("Error loading MediaPipe model:", error);
}
```

If the CDN is unreachable or the model download fails, only a `console.error` is emitted. `isModelLoaded` stays `false` forever. **The user sees "Loading AI Model…" indefinitely** with no error or retry option.

**Fix:** Expose an `isModelError` / `modelError` state from the hook and show a proper error message in the UI.

---

### BUG-19 · GPU delegate hardcoded — silently fails on unsupported devices
**File:** `src/hooks/useHandTracking.ts`  

```ts
delegate: "GPU"
```

Devices without WebGL2 support (older mobile browsers, certain privacy modes) will fail silently or throw. There is no fallback to `"CPU"`.

**Fix:** Try GPU first, catch the error, fall back to `"CPU"`.

---

### BUG-20 · `video.play()` is never explicitly called — autoplay may be blocked
**File:** `src/components/CameraView.tsx`  

The `<video>` has `autoPlay` which is blocked by browser policy on some mobile browsers without prior user interaction. The stream gets attached but the video never plays, `currentTime` stays `0`, and MediaPipe's `lastVideoTimeRef.current !== videoElement.currentTime` guard never advances — **no frames are ever processed**.

**Fix:** Explicitly call `videoRef.current.play()` after setting `srcObject`, with `.catch()` error handling.

---

## 🟡 UI / UX Bugs

---

### BUG-21 · "End Session" doesn't stop active recording — data is silently lost
**File:** `src/App.tsx`  

Clicking "End Session" un-mounts `CameraView` while recording may be in progress. `handleStopRecording` is never called, so the recording is not saved. The user loses their work with **no warning or confirmation dialog**.

---

### BUG-22 · No visual confirmation that a recording was saved
**File:** `src/components/CameraView.tsx`  

After stopping a recording, the only change is the "Play Ghost Hand" button appearing. There is no toast notification, saved timestamp display, or "Recording saved ✓" confirmation. Users may not notice the button appeared.

---

### BUG-23 · Loading state text is not centered — stuck in top-left corner
**File:** `src/components/CameraView.tsx`  

```tsx
<div style={{ position: 'absolute', zIndex: 20 }}>
```

The loading message has no `top/left` centering, so it appears at the **top-left of the container** instead of the center of the video. It should be centered with `top: '50%', left: '50%', transform: 'translate(-50%, -50%)'`.

---

### BUG-24 · "Start Recording" and "Play Ghost Hand" are enabled before model loads
**File:** `src/components/CameraView.tsx`  

Both action buttons are clickable before `isModelLoaded && isReady`. A user who clicks "Start Recording" before the model loads will record an empty session without knowing it.

**Fix:** Add `disabled={!isModelLoaded || !isReady}` to both buttons.

---

### BUG-25 · `.btn-secondary` hover state is near invisible — inconsistent UX
**File:** `src/index.css`  

```css
.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.05);
}
```

The hover only barely changes the background. No `transform`, no `box-shadow`, no border highlight — compared to `btn-primary`'s polished hover effect. Inconsistent and flat.

---

### BUG-26 · `layout-container` `max-width: 1200px` unnecessarily constrains camera view
**File:** `src/index.css`  

The entire app is in `.layout-container` with `max-width: 1200px`. On wide monitors the camera view is artificially capped — critical for a hand tracking application where screen real estate matters.

---

### BUG-27 · Live hand rendered with harsh `#00ff00` and `#ff0000` colors
**File:** `src/components/CameraView.tsx`  

```ts
drawLandmarks(ctx, canvas, result.landmarks, '#00ff00', '#ff0000');
```

Pure lime green and pure red are visually harsh against the dark glassmorphism UI. The ghost hand uses properly muted `rgba` values — the live hand should too.

---

### BUG-28 · No recording duration timer shown while recording
**File:** `src/components/CameraView.tsx`  

While recording is active, there is no elapsed time counter or visual indicator of recording duration. The user has no idea if they've been recording for 2 seconds or 2 minutes.

---

### BUG-29 · App favicon is still the default Vite logo
**File:** `/public/favicon.svg`  

The favicon is likely the default Vite template SVG. The app is branded as "Osmosis" but the browser tab icon shows a generic Vite icon.

---

## 🔵 Code Quality / Technical Debt

---

### BUG-30 · `React` default import is unnecessary with modern JSX transform
**File:** `src/components/CameraView.tsx` line 1  

```ts
import React, { useEffect, useRef, useState } from 'react';
```

`tsconfig.app.json` uses `"jsx": "react-jsx"` — the new JSX transform is active and `React` doesn't need to be imported for JSX. This is dead/legacy code.

---

### BUG-31 · `drawLandmarks` is recreated on every render — should be outside component
**File:** `src/components/CameraView.tsx`  

`drawLandmarks` is defined as a `const` inside the component body, causing it to be re-created on every render. It's used inside a `useEffect` but is not in its dependency array (which is also a correctness bug). It should be defined outside the component.

---

### BUG-32 · `onStreamReady` and `onError` props defined but never passed by parent
**File:** `src/App.tsx` / `src/components/CameraView.tsx`  

`CameraView` defines `onStreamReady` and `onError` in its props interface, but `App.tsx` renders `<CameraView />` with no props. These are dead interface surface area.

---

### BUG-33 · `isRecording` / `isPlaying` state read inside rAF callbacks — stale closure risk
**File:** `src/components/CameraView.tsx`  

`isRecording` and `isPlaying` are React state values read inside the `setOnResults` callback (which runs inside a `useEffect`). Stale closures mean the drawing logic may act on old state values between renders.

**Fix:** Use refs (e.g. `isRecordingRef`) synced with state for values read inside rAF/animation callbacks.

---

### BUG-34 · TypeScript `strict` mode is not enabled
**File:** `tsconfig.app.json`  

`"strict": true` is missing. Many implicit `any` types, potential null dereferences, and unsafe patterns in the codebase are not being caught by the compiler.

---

### BUG-35 · No `"text-muted"` class — CSS variable defined but utility class missing (duplicate)
> *(See BUG-11 — this is the same root cause, listed here for completeness in code-quality context: the project pattern of defining CSS variables without their utility class counterparts will cause more issues as the codebase grows.)*

---

*End of Bug Report — **35 bugs** identified.*  
*Severity: 🔴 Critical (10) · 🟠 Moderate (10) · 🟡 UI/UX (9) · 🔵 Code Quality (6)*
