# How to Run Osmosis V2 (B2B Med-Tech Edition)

Follow these steps to run the Osmosis web application on your local machine. This project uses Vite, React, TypeScript, and Tailwind CSS v4.

## 1. Install Dependencies

Before running the project for the first time, or if any new packages have been added, you need to install the Node dependencies.

Open your terminal, navigate to the root folder of the project (`/Users/shaanm/Projects/ACE/VinHack`), and run:

```bash
npm install
```

*Note: This will download and install everything required, including Vite, Framer Motion, Recharts, Zustand, and Tailwind CSS.*

## 2. Start the Development Server

Once the dependencies are installed, you can start the Vite development server. This server supports Hot Module Replacement (HMR), meaning any code changes you make will instantly update in the browser.

Run the following command in your terminal:

```bash
npm run dev
```

## 3. Access the Application

After running the start command, Vite will output a local URL in your terminal. It usually looks like this:

```
  VITE v5.x.x  ready in 250 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

*(Note: If port `5173` is already in use, Vite might automatically switch to `5174` or another port. Always check the terminal output for the exact URL!)*

1. Open your web browser (Chrome, Safari, Firefox).
2. Go to the provided local URL (e.g., `http://localhost:5173` or `http://localhost:5174`).

## 4. Troubleshooting

- **"command not found: npn"**: Make sure you type `npm` (Node Package Manager) with an 'm', not 'n'.
- **Camera Not Working**: Ensure you grant camera permissions in your browser when prompted. The application requires webcam access to run the MediaPipe AI models.
- **Port already in use**: If you want to force a specific port, you can run: `npm run dev -- --port 5174`
