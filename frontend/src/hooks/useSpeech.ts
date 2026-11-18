import { useState, useEffect, useRef } from 'react';

export function useSpeech(lang: 'en-IN' | 'kn-IN' | 'hi-IN') {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [error, setError] = useState('');
    const recognitionRef = useRef<any>(null);

    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setError('Speech recognition is not supported in this browser.');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onresult = (event: any) => {
            const current = event.resultIndex;
            const text = event.results?.[current]?.[0]?.transcript;
            if (!text) {
                setError('No speech was detected. Please try again.');
                return;
            }
            setTranscript(text);
        };

        recognition.onend = () => setIsListening(false);
        recognition.onerror = (event: any) => {
            setIsListening(false);
            setError(event.error === 'not-allowed' || event.error === 'service-not-allowed'
                ? 'Microphone access is blocked. Allow microphone access and try again.'
                : `Speech recognition failed${event.error ? `: ${event.error}` : '.'}`);
        };

        recognitionRef.current = recognition;
        return () => {
            recognition.onresult = null;
            recognition.onend = null;
            recognition.onerror = null;
            recognitionRef.current = null;
        };
    }, []);

    const listen = () => {
        const recognition = recognitionRef.current;
        if (!recognition) {
            setError('Speech recognition is not available in this browser.');
            return;
        }
        try {
            setError('');
            setTranscript('');
            recognition.lang = lang;
            recognition.start();
            setIsListening(true);
        } catch (startError) {
            setIsListening(false);
            setError(startError instanceof Error ? startError.message : 'Could not start speech recognition.');
        }
    };

    return { isListening, transcript, listen, error };
}