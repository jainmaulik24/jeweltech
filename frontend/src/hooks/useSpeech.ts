import { useEffect, useRef, useState } from 'react';

interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionResult extends ArrayLike<SpeechRecognitionAlternative> {
  isFinal: boolean;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResult>;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

function messageForError(error: string): string {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Allow microphone access and try again.';
    case 'no-speech':
      return 'No speech was detected. Please try again.';
    case 'audio-capture':
      return 'No microphone was found or it is unavailable.';
    case 'network':
      return 'Speech recognition could not reach its service. Check your connection and try again.';
    default:
      return `Speech recognition failed${error ? `: ${error}` : '.'}`;
  }
}

function isLocalOrigin(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function useSpeech(
  lang: 'en-IN' | 'kn-IN' | 'hi-IN',
  onTranscript?: (transcript: string) => void,
) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isListeningRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onend = null;
    recognition.onerror = null;
    try {
      recognition.abort();
    } catch (abortError) {
      console.log('[voice input] cleanup failed:', abortError);
    }
    recognitionRef.current = null;
    isListeningRef.current = false;
  }, []);

  const listen = () => {
    if (isListeningRef.current) {
      try {
        recognitionRef.current?.stop();
      } catch (stopError) {
        console.log('[voice input] stop failed:', stopError);
        setError(messageForError(stopError instanceof Error ? stopError.message : 'unknown'));
      }
      return;
    }

    if (!window.isSecureContext && !isLocalOrigin(window.location.hostname)) {
      const originError = new Error('Voice input requires HTTPS or localhost.');
      console.log('[voice input] insecure origin:', originError);
      setError(originError.message);
      return;
    }

    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      const unsupportedError = new Error('Speech recognition is not supported in this browser.');
      console.log('[voice input] unsupported browser:', unsupportedError);
      setError(unsupportedError.message);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const segments: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const segment = event.results[index]?.[0]?.transcript;
        if (segment) segments.push(segment.trim());
      }
      const nextTranscript = segments.join(' ').trim();
      if (!nextTranscript) return;
      setTranscript(nextTranscript);
      onTranscriptRef.current?.(nextTranscript);
    };
    recognition.onerror = (event) => {
      console.log('[voice input] recognition error:', event.error);
      isListeningRef.current = false;
      setIsListening(false);
      setError(messageForError(event.error));
    };
    recognition.onend = () => {
      isListeningRef.current = false;
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    try {
      setError('');
      setTranscript('');
      recognition.start();
      isListeningRef.current = true;
      setIsListening(true);
    } catch (startError) {
      console.log('[voice input] failed to start:', startError);
      isListeningRef.current = false;
      setIsListening(false);
      setError(messageForError(startError instanceof Error ? startError.message : 'unknown'));
    }
  };

  return { isListening, transcript, listen, error };
}
