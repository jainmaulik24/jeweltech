import { useState, useEffect, useRef } from 'react';

export function useSpeech(lang: 'en-IN' | 'kn-IN') {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const recognitionRef = useRef<any>(null);

    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.error("Speech Recognition not supported in this browser.");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onresult = (event: any) => {
            const current = event.resultIndex;
            const text = event.results[current][0].transcript;
            setTranscript(text);
        };

        recognition.onend = () => setIsListening(false);
        recognition.onerror = () => setIsListening(false);

        recognitionRef.current = recognition;
    }, []);

    const listen = () => {
        if (recognitionRef.current) {
            recognitionRef.current.lang = lang;
            recognitionRef.current.start();
            setIsListening(true);
            setTranscript('');
        }
    };

    return { isListening, transcript, listen };
}