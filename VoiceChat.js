// frontend/src/components/VoiceChat/VoiceChat.js

import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './VoiceChat.css';
import logo from '../../assets/spoc-ai_192.png';
import MenuBar from '../shared/MenuBar';
import { Mic, Square, Volume2, Loader2 } from 'lucide-react';
import avatargif from '../../assets/spoc.ai_avatar.gif';
import avatarpng from '../../assets/spoc.ai__avatar.png';


function VoiceChat() {
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [conversation, setConversation] = useState([]);
    const [error, setError] = useState('');
    const [threadId, setThreadId] = useState(() => {
        return localStorage.getItem('voiceThreadId') || null;
    });
    const speechRecognitionRef = useRef(null);
    const speechSynthesisRef = useRef(null);
    const baseUrl = process.env.REACT_APP_BASE_URL;
    const navigate = useNavigate();

    // Check authentication
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const response = await fetch(`${baseUrl}/api/check-auth`, {
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                    }
                });

                if (!response.ok) {
                    navigate('/mainapp/login', { replace: true });
                    return;
                }

                const data = await response.json();
            } catch (error) {
                console.error('Auth check error:', error);
                navigate('/mainapp/login', { replace: true });
            }
        };

        checkAuth();
    }, [baseUrl, navigate]);

    // Initialize Speech Recognition
    // Initialize Speech Recognition
    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            setError('Speech Recognition is not supported in your browser. Please use Chrome or Edge.');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 1;

        let recordingStartTime = null;
        let hasReceivedResult = false;

        recognition.onstart = () => {
            setError('');
            recordingStartTime = Date.now();
            hasReceivedResult = false;
            console.log('🎤 Recording started');
        };

        recognition.onresult = (event) => {
            console.log('📝 Result received:', event.results);

            if (event.results && event.results.length > 0) {
                const transcriptText = event.results[0].transcript;
                hasReceivedResult = true;

                console.log('✅ Captured audio:', transcriptText);

                if (transcriptText && transcriptText.trim().length > 0) {
                    handleSendMessage(transcriptText);
                }
            }
        };

        recognition.onerror = (event) => {
            console.error('❌ Speech recognition error:', event.error);

            // Ignore "no-speech" error if button was released too quickly
            if (event.error === 'no-speech') {
                const recordingDuration = recordingStartTime ? Date.now() - recordingStartTime : 0;
                if (recordingDuration < 500) {
                    setError('Please hold the button longer while speaking');
                } else {
                    setError('No speech detected. Please try again.');
                }
            } else if (event.error !== 'aborted') {
                setError(`Speech recognition error: ${event.error}`);
            }
            setIsRecording(false);
        };

        recognition.onend = () => {
            console.log('🛑 Recording ended');
            setIsRecording(false);

            // If no result was received and recording was very short
            if (!hasReceivedResult && recordingStartTime) {
                const duration = Date.now() - recordingStartTime;
                if (duration < 500) {
                    setError('Hold the button for at least 1 second while speaking');
                }
            }
        };

        speechRecognitionRef.current = recognition;

        return () => {
            if (speechRecognitionRef.current) {
                speechRecognitionRef.current.abort();
            }
            if (speechSynthesisRef.current) {
                window.speechSynthesis.cancel();
            }
        };
    }, []);

    const startRecording = () => {
        setError('');
        setTranscript('');

        if (speechRecognitionRef.current && !isProcessing && !isSpeaking) {
            try {
                // Check if already recording to prevent multiple starts
                if (isRecording) return;

                speechRecognitionRef.current.start();
                setIsRecording(true);
            } catch (err) {
                // If already started, ignore the error
                if (err.message && err.message.includes('already started')) {
                    console.log('Recognition already active');
                } else {
                    console.error('Error starting recording:', err);
                    setError('Failed to start recording. Please try again.');
                }
            }
        }
    };

    const stopRecording = () => {
        if (speechRecognitionRef.current && isRecording) {
            try {
                console.log('Stopping recording...'); // Debug log
                speechRecognitionRef.current.stop();
                // Don't set isRecording to false yet - let onend handle it
            } catch (err) {
                console.error('Error stopping recording:', err);
                setIsRecording(false);
            }
        }
    };

    const handleSendMessage = async (message) => {
        if (!message.trim() || isProcessing) return;

        setIsProcessing(true);
        setError('');
        setTranscript(''); // Clear transcript when processing starts

        const userMessage = {
            id: Date.now(),
            sender: 'user',
            text: message,
            timestamp: new Date().toLocaleTimeString()
        };

        // Prevent duplicate user messages
        setConversation(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.text === message && lastMsg.sender === 'user') {
                return prev;
            }
            return [...prev, userMessage];
        });

        try {
            const storedThreadId = localStorage.getItem('voiceThreadId');
            const threadIdToSend = storedThreadId && storedThreadId !== 'null' && storedThreadId !== 'undefined'
                ? storedThreadId
                : null;

            const response = await fetch(`${baseUrl}/api/voice-message`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message,
                    thread_id: threadIdToSend
                })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || 'Failed to get response');
            }

            // Save thread ID for continuity
            if (data.thread_id) {
                setThreadId(data.thread_id);
                localStorage.setItem('voiceThreadId', data.thread_id);
            }

            const assistantMessage = {
                id: Date.now() + 1,
                sender: 'assistant',
                text: data.reply,
                timestamp: new Date().toLocaleTimeString()
            };

            // Prevent duplicate assistant messages
            setConversation(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.text === data.reply && lastMsg.sender === 'assistant') {
                    return prev;
                }
                return [...prev, assistantMessage];
            });

            speakText(data.reply);

        } catch (error) {
            console.error('Error sending message:', error);
            setError('Failed to process your message. Please try again.');
            setIsProcessing(false);
        }
    };

    const speakText = (text) => {
        if (!text) {
            setIsProcessing(false);
            return;
        }

        // Cancel any ongoing speech
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        utterance.onstart = () => {
            setIsSpeaking(true);
        };

        utterance.onend = () => {
            setIsSpeaking(false);
            setIsProcessing(false);
        };

        utterance.onerror = (event) => {
            console.error('Speech synthesis error:', event);
            setIsSpeaking(false);
            setIsProcessing(false);
        };

        window.speechSynthesis.speak(utterance);
        speechSynthesisRef.current = utterance;
    };

    const stopSpeaking = () => {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
        setIsProcessing(false);
    };

    const clearConversation = () => {
        setConversation([]);
        setTranscript('');
        setError('');
    };

    return (
        <div className="app-body">
            <div className="card voice-chat-card">
                {/* Left Column */}
                <div className="left-column">
                    {/* Header */}
                    <div className="voice-chat-header">
                        <img src={logo} alt="spoc.ai Logo" className="logo-img" />
                        <h2 className="voice-title">Virtual Assistant</h2>
                    </div>

                    {/* Error Display */}
                    {error && (
                        <div className="error-message">
                            {error}
                        </div>
                    )}

                    {/* Conversation Display */}
                    <div className="conversation-display">
                        {conversation.length === 0 ? (
                            <div className="welcome-text">
                                <p>Welcome to Voice Activated Virtual Assistant!</p>
                                <p>Press the microphone button and start speaking...</p>
                            </div>
                        ) : (
                            conversation.map((msg) => (
                                <div
                                    key={msg.id}
                                    className={`message-bubble ${msg.sender}`}
                                >
                                    <div className="message-header">
                                        <strong>{msg.sender === 'user' ? 'You' : 'spoc.ai'}</strong>
                                        <span className="message-time">{msg.timestamp}</span>
                                    </div>
                                    <div className="message-text">{msg.text}</div>
                                </div>
                            ))
                        )}

                        {/* Processing Indicator */}
                        {isProcessing && !isSpeaking && (
                            <div className="processing-indicator">
                                <Loader2 className="spinner-icon" />
                                <span>Processing your message...</span>
                            </div>
                        )}

                        {/* Speaking Indicator */}
                        {isSpeaking && (
                            <div className="speaking-indicator">
                                <div className="sound-wave">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                </div>
                                <button
                                    onClick={stopSpeaking}
                                    className="stop-speaking-btn"
                                >
                                    <Square size={16} />
                                    Stop Speaking
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column */}
                <div className="right-column">
                    <MenuBar />

                    {/* Instructions Section - Half Height */}
                    <div className="instructions-wrapper">
                        <div className="instructions">
                            <img
                                src={isSpeaking ? avatargif : avatarpng}
                                alt="Avatar"
                                className={`instructions-image ${isSpeaking ? 'talking' : 'idle'}`}
                            />

                        </div>
                    </div>

                    {/* Voice Control Button - Moved Here, Reduced Size */}
                    <div className="voice-controls-right">
                        <button
                            className={`record-btn ${isRecording ? 'recording' : ''}`}
                            onMouseDown={startRecording}
                            onMouseUp={stopRecording}
                            onMouseLeave={stopRecording}
                            onTouchStart={startRecording}
                            onTouchEnd={stopRecording}
                            disabled={isProcessing || isSpeaking}
                        >
                            <div className="mic-icon">
                                {isRecording ? <Square size={32} /> : <Mic size={32} />}
                            </div>
                            <span className="record-text">
                                {isRecording ? 'Release to Send' : 'Hold to Talk'}
                            </span>
                        </button>

                        {isRecording && (
                            <div className="recording-pulse">
                                <span className="pulse-dot"></span>
                                Recording... Speak now!
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default VoiceChat;