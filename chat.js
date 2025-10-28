const chatBox = document.getElementById('chat-box');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const micButton = document.getElementById('mic-button');
const recordingStatus = document.getElementById('recording-status');
const voiceSelect = document.getElementById('voice-select');
const liveBadge = document.getElementById('live-badge');

// WebSocket proxy configuration
const WS_PROXY_HOST = 'localhost';
const WS_PROXY_PORT = 8080;
const WS_BACKEND_URL = `ws://${WS_PROXY_HOST}:${WS_PROXY_PORT}`;

let chatHistory = [];
let isProcessing = false;

// ===== GEMINI LIVE API STREAMING =====
let liveSession = null;
let audioContext = null;
let mediaStream = null;
let audioWorkletNode = null;
let isStreaming = false;
let isSpeaking = false;
let setupComplete = false;

// Audio playback management
let nextPlayTime = 0;
let audioChunksReceived = 0;

/**
 * Initialize Web Audio API context
 */
async function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 24000 // Match Gemini's output rate
        });
        console.log('🎵 AudioContext initialized at', audioContext.sampleRate, 'Hz');
    }
    
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
        console.log('▶️ AudioContext resumed');
    }
}

/**
 * Convert Float32Array to Int16Array PCM
 */
function float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
}

/**
 * Convert Int16Array to base64
 */
function int16ToBase64(int16Array) {
    const bytes = new Uint8Array(int16Array.buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Play audio chunk from Gemini response
 */
async function playAudioChunk(base64Audio) {
    try {
        await initAudioContext();
        
        // Force resume if suspended
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
            console.log('▶️ AudioContext resumed for playback');
        }
        
        // Decode base64 to binary
        const binaryString = atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Verify we have data
        if (bytes.length === 0) {
            console.warn('⚠️ Received empty audio chunk');
            return;
        }
        
        // Convert to Int16Array (16-bit PCM from Gemini)
        const int16Array = new Int16Array(bytes.buffer);
        
        // Convert Int16 PCM to Float32 for Web Audio API
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }
        
        console.log(`🎵 Decoded audio: ${int16Array.length} samples (${(int16Array.length / 24000).toFixed(2)}s at 24kHz)`);
        
        // Create audio buffer at 24kHz (Gemini's output rate)
        const audioBuffer = audioContext.createBuffer(1, float32Array.length, 24000);
        audioBuffer.getChannelData(0).set(float32Array);
        
        // Create gain node for volume control
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 1.0; // Full volume
        gainNode.connect(audioContext.destination);
        
        // Schedule playback for smooth streaming
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(gainNode);
        
        const currentTime = audioContext.currentTime;
        const startTime = Math.max(currentTime, nextPlayTime);
        
        // Add small overlap to prevent gaps
        const overlap = 0.01; // 10ms overlap
        source.start(Math.max(0, startTime - overlap));
        
        // Update next play time for gapless playback
        nextPlayTime = startTime + audioBuffer.duration;
        
        audioChunksReceived++;
        console.log(`🔊 PLAYING chunk #${audioChunksReceived} at ${startTime.toFixed(3)}s | Duration: ${audioBuffer.duration.toFixed(3)}s | Next: ${nextPlayTime.toFixed(3)}s`);
        console.log(`🔊 AudioContext state: ${audioContext.state}`);
        
        // Debug: Play a test tone on first chunk
        if (audioChunksReceived === 1) {
            console.log('🎺 First audio chunk - verifying playback capability...');
        }
        
    } catch (error) {
        console.error('❌ Audio playback error:', error);
        console.error('Stack:', error.stack);
    }
}

/**
 * Start Gemini Live streaming session
 */
async function startLiveSession() {
    if (isStreaming) {
        console.warn('⚠️ Live session already active');
        return;
    }
    
    try {
        console.log('\n🚀 Starting Gemini Live session...');
        setupComplete = false;
        audioChunksReceived = 0;
        nextPlayTime = 0;
        
        // Initialize audio context first - CRITICAL for playback
        await initAudioContext();
        
        // Force user interaction to unlock audio (browser requirement)
        if (audioContext.state === 'suspended') {
            console.log('🔓 Attempting to unlock AudioContext...');
            await audioContext.resume();
            
            // Play silent sound to fully unlock
            const silentBuffer = audioContext.createBuffer(1, 1, 22050);
            const silentSource = audioContext.createBufferSource();
            silentSource.buffer = silentBuffer;
            silentSource.connect(audioContext.destination);
            silentSource.start();
            
            console.log('✅ AudioContext unlocked and ready');
        }
        
        console.log(`🔊 Audio System Status: ${audioContext.state} at ${audioContext.sampleRate}Hz`);
        
        // Request microphone access
        console.log('🎤 Requesting microphone access...');
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        console.log('✅ Microphone access granted');
        
        // Connect to WebSocket proxy
        console.log('🔗 Connecting to WebSocket:', WS_BACKEND_URL);
        liveSession = new WebSocket(WS_BACKEND_URL);
        
        liveSession.onopen = () => {
            console.log('✅ WebSocket connected to proxy');
            isStreaming = true;
            
            // Update UI
            micButton.classList.add('recording');
            micButton.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
            recordingStatus.classList.add('show');
            recordingStatus.innerHTML = `
                <div class="pulse-circle">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    </svg>
                </div>
                <div class="status-text">🎙️ Listening...</div>
                <div class="status-hint">Click to stop</div>
            `;
            liveBadge.classList.add('active');
            
            if (navigator.vibrate) {
                navigator.vibrate(100);
            }
            
            // Wait a moment for setup to complete, then start streaming
            setTimeout(() => {
                if (isStreaming) {
                    startAudioStreaming();
                }
            }, 500);
        };
        
        liveSession.onmessage = async (event) => {
            try {
                const message = JSON.parse(event.data);
                
                // Handle connection confirmation
                if (message.type === 'connected') {
                    console.log('✅ Backend confirmed:', message.message);
                    setupComplete = true;
                    
                    // Ensure audio is ready
                    if (audioContext.state === 'suspended') {
                        await audioContext.resume();
                        console.log('🔓 AudioContext resumed on connection');
                    }
                    return;
                }
                
                // Handle audio response from Gemini
                if (message.type === 'audio') {
                    console.log('📥 Received audio chunk from Gemini (length: ' + message.data.length + ' chars)');
                    
                    if (!isSpeaking) {
                        isSpeaking = true;
                        recordingStatus.innerHTML = `
                            <div class="pulse-circle">
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                                </svg>
                            </div>
                            <div class="status-text">🔊 AI Speaking...</div>
                            <div class="status-hint">Click to stop</div>
                        `;
                        
                        // Ensure AudioContext is running when AI starts speaking
                        if (audioContext.state !== 'running') {
                            await audioContext.resume();
                            console.log('🔓 AudioContext resumed for AI speech');
                        }
                    }
                    
                    await playAudioChunk(message.data);
                }
                
                // Handle text transcription
                else if (message.type === 'text') {
                    console.log('📝 Gemini text:', message.text);
                    addMessage('IELTS Bot', message.text);
                }
                
                // Handle turn complete
                else if (message.type === 'turnComplete') {
                    console.log('✅ Turn complete - AI finished speaking');
                    console.log(`🔊 Total audio chunks received: ${audioChunksReceived}`);
                    isSpeaking = false;
                    
                    if (isStreaming) {
                        recordingStatus.innerHTML = `
                            <div class="pulse-circle">
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                                </svg>
                            </div>
                            <div class="status-text">🎙️ Listening...</div>
                            <div class="status-hint">Click to stop</div>
                        `;
                    }
                }
                
                // Handle errors
                else if (message.type === 'error') {
                    console.error('❌ Gemini error:', message.error);
                    addMessage('Error', message.error);
                    stopLiveSession();
                }
                
            } catch (error) {
                console.error('❌ Message parse error:', error);
            }
        };
        
        liveSession.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            addMessage('Error', 'Connection error. Make sure the proxy server is running on port 8080.');
            stopLiveSession();
        };
        
        liveSession.onclose = (event) => {
            console.log('🔌 WebSocket closed:', event.code, event.reason);
            if (isStreaming) {
                stopLiveSession();
            }
        };
        
    } catch (error) {
        console.error('❌ Failed to start live session:', error);
        if (error.name === 'NotAllowedError') {
            addMessage('Error', 'Microphone access denied. Please allow microphone access and try again.');
        } else {
            addMessage('Error', error.message || 'Could not start voice session');
        }
        stopLiveSession();
    }
}

/**
 * Stream microphone audio to backend
 */
async function startAudioStreaming() {
    try {
        console.log('🎵 Starting audio streaming...');
        
        const source = audioContext.createMediaStreamSource(mediaStream);
        
        // Use ScriptProcessor for broader compatibility
        const bufferSize = 2048; // Smaller buffer for lower latency
        const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
        
        let chunksSent = 0;
        
        processor.onaudioprocess = (event) => {
            if (!isStreaming || !liveSession || liveSession.readyState !== WebSocket.OPEN) {
                return;
            }
            
            const inputData = event.inputBuffer.getChannelData(0);
            
            // Resample from current sample rate to 16kHz (Gemini's expected input rate)
            const targetSampleRate = 16000;
            const ratio = audioContext.sampleRate / targetSampleRate;
            const targetLength = Math.floor(inputData.length / ratio);
            const resampled = new Float32Array(targetLength);
            
            for (let i = 0; i < targetLength; i++) {
                resampled[i] = inputData[Math.floor(i * ratio)];
            }
            
            // Convert to Int16 PCM
            const int16Data = float32ToInt16(resampled);
            const base64Audio = int16ToBase64(int16Data);
            
            // Send to backend
            try {
                liveSession.send(JSON.stringify({
                    type: 'audio',
                    data: base64Audio,
                    mimeType: 'audio/pcm;rate=16000'
                }));
                
                chunksSent++;
                if (chunksSent % 20 === 0) {
                    console.log(`📤 Sent ${chunksSent} audio chunks to Gemini`);
                }
            } catch (error) {
                console.error('❌ Error sending audio:', error);
            }
        };
        
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        // Store reference for cleanup
        audioWorkletNode = processor;
        
        console.log('✅ Audio streaming active');
        
    } catch (error) {
        console.error('❌ Audio streaming error:', error);
        stopLiveSession();
    }
}

/**
 * Stop Gemini Live session
 */
function stopLiveSession() {
    console.log('\n🛑 Stopping live session...');
    
    isStreaming = false;
    isSpeaking = false;
    setupComplete = false;
    
    // Stop audio streaming
    if (audioWorkletNode) {
        try {
            audioWorkletNode.disconnect();
        } catch (e) {
            // Ignore disconnect errors
        }
        audioWorkletNode = null;
    }
    
    // Stop microphone
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => {
            track.stop();
            console.log('🎤 Microphone track stopped');
        });
        mediaStream = null;
    }
    
    // Close WebSocket
    if (liveSession) {
        if (liveSession.readyState === WebSocket.OPEN || liveSession.readyState === WebSocket.CONNECTING) {
            liveSession.close();
            console.log('🔌 WebSocket closed');
        }
        liveSession = null;
    }
    
    // Reset playback queue
    nextPlayTime = 0;
    audioChunksReceived = 0;
    
    // Update UI
    micButton.classList.remove('recording');
    micButton.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="23"/>
          <line x1="8" y1="23" x2="16" y2="23"/>
        </svg>`;
    recordingStatus.classList.remove('show');
    liveBadge.classList.remove('active');
    
    if (navigator.vibrate) {
        navigator.vibrate([50, 50, 50]);
    }
    
    console.log('✅ Live session stopped\n');
}

/**
 * Toggle live session (click to start/stop)
 */
function toggleLiveSession() {
    if (isStreaming) {
        stopLiveSession();
    } else {
        startLiveSession();
    }
}

// ===== MESSAGE HANDLING (for text input) =====
function addMessage(sender, message) {
    const messageElement = document.createElement('div');
    messageElement.className = sender === 'You' ? 'message user-message' : 'message bot-message';
    messageElement.innerHTML = message.replace(/\n/g, '<br>');
    
    chatBox.appendChild(messageElement);
    
    // Smooth scroll
    setTimeout(() => {
        messageElement.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'end'
        });
    }, 50);
    
    // Remove empty state on first message
    const emptyState = chatBox.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }
}

async function sendMessage(messageText = null) {
    const userMessage = messageText || messageInput.value.trim();
    if (!userMessage || isProcessing) return;

    // Disable input during processing
    isProcessing = true;
    messageInput.disabled = true;
    sendButton.disabled = true;
    micButton.disabled = true;
    
    addMessage('You', userMessage);
    if (!messageText) messageInput.value = '';
    
    // Show typing indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'typing-indicator';
    typingDiv.id = 'typing-indicator';
    typingDiv.innerHTML = `<span></span><span></span><span></span>`;
    chatBox.appendChild(typingDiv);
    chatBox.scrollTop = chatBox.scrollHeight;

    chatHistory.push({ role: 'user', parts: [{ text: userMessage }] });

    try {
        const response = await fetch('text-message.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: userMessage,
                history: chatHistory
            }),
        });

        const data = await response.json();
        
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) typingIndicator.remove();

        if (data.error) {
            addMessage('Error', data.error);
        } else {
            const botMessage = data.reply;
            addMessage('IELTS Bot', botMessage);
            chatHistory.push({ role: 'model', parts: [{ text: botMessage }] });
        }

    } catch (error) {
        console.error('❌ Fetch Error:', error);
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) typingIndicator.remove();
        addMessage('Error', 'Could not connect to the server.');
    } finally {
        isProcessing = false;
        messageInput.disabled = false;
        sendButton.disabled = false;
        micButton.disabled = false;
        messageInput.focus();
    }
}

// ===== EVENT LISTENERS =====
sendButton.addEventListener('click', () => sendMessage());

messageInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Click to toggle recording (instead of hold)
micButton.addEventListener('click', (e) => {
    e.preventDefault();
    toggleLiveSession();
});

// Prevent context menu on mic button
micButton.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

// Handle page visibility
document.addEventListener('visibilitychange', () => {
    if (document.hidden && isStreaming) {
        console.warn('⚠️ Page hidden, stopping live session');
        stopLiveSession();
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (isStreaming) {
        stopLiveSession();
    }
});

// Initial setup
console.log('🚀 IELTS Bot initialized');
console.log('🔗 WebSocket proxy URL:', WS_BACKEND_URL);
console.log('🔋 Click microphone button once to start, click again to stop\n');
addMessage('IELTS Bot', 'Hello! I\'m your IELTS preparation assistant. You can type your questions or click the microphone button to speak with me in real-time!');

// Add test audio button for debugging
window.testAudio = async function() {
    console.log('\n🎺 Testing Audio System...');
    
    try {
        await initAudioContext();
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
            console.log('🔓 AudioContext resumed');
        }
        
        console.log(`🔊 AudioContext State: ${audioContext.state}`);
        console.log(`🔊 Sample Rate: ${audioContext.sampleRate}Hz`);
        
        // Create a simple test tone (440Hz - A note)
        const duration = 0.5; // 0.5 seconds
        const sampleRate = audioContext.sampleRate;
        const numSamples = duration * sampleRate;
        const buffer = audioContext.createBuffer(1, numSamples, sampleRate);
        const data = buffer.getChannelData(0);
        
        // Generate sine wave
        const freq = 440; // A4 note
        for (let i = 0; i < numSamples; i++) {
            data[i] = Math.sin(2 * Math.PI * freq * i / sampleRate) * 0.3;
        }
        
        // Play the tone
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start();
        
        console.log('✅ Test tone played! If you heard a beep, audio is working.');
        console.log('   If not, check:');
        console.log('   - System volume');
        console.log('   - Browser is not muted');
        console.log('   - Audio output device');
        
    } catch (error) {
        console.error('❌ Test audio failed:', error);
    }
};

// Log instructions
console.log('💡 To test audio playback, run in console: testAudio()');
console.log('💡 To check AudioContext: audioContext.state');
console.log('💡 To resume audio: audioContext.resume()');
console.log('');