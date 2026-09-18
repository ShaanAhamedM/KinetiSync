import { useEffect, useState, useCallback, useRef } from 'react';

export const useVoiceControl = (commands: Record<string, () => void>) => {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);

  const initRecognition = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech recognition not supported in this browser.');
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      isListeningRef.current = true;
    };
    
    recognition.onend = () => {
      if (isListeningRef.current) {
        // Auto-restart if we haven't manually toggled off (BUG-39)
        try {
          recognition.start();
        } catch (e) {
          console.warn("Failed to auto-restart recognition", e);
          setIsListening(false);
          isListeningRef.current = false;
        }
      } else {
        setIsListening(false);
      }
    };
    
    recognition.onerror = (e: any) => setError(e.error);

    recognition.onresult = (event: any) => {
      const lastResult = event.results[event.results.length - 1];
      if (lastResult.isFinal) {
        const transcript = lastResult[0].transcript.trim().toLowerCase();
        
        console.log("🗣️ Voice Command Heard:", transcript);

        for (const [command, action] of Object.entries(commands)) {
          if (transcript.includes(command.toLowerCase())) {
            action();
          }
        }
      }
    };

    return recognition;
  }, [commands]);

  const toggleListening = useCallback(() => {
    if (isListeningRef.current) {
      isListeningRef.current = false;
      setIsListening(false);
      recognitionRef.current?.stop();
    } else {
      isListeningRef.current = true;
      setIsListening(true);
      if (!recognitionRef.current) {
        recognitionRef.current = initRecognition();
      }
      try {
        recognitionRef.current?.start();
      } catch (e) {
        console.warn("Recognition already started");
      }
    }
  }, [initRecognition]);

  // Clean up
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  return { isListening, toggleListening, error };
};
