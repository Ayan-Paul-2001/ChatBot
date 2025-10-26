const chatBox = document.getElementById('chat-box');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const micButton = document.getElementById('mic-button');
const recordingStatus = document.getElementById('recording-status');
const voiceSelect = document.getElementById('voice-select');
const backendUrl = 'Test.php';
let chatHistory = [];

// Loading states
let isProcessing = false;

// ===== VOICE RECORDING =====
let mediaRecorder = null;
let audioChunks = [];
let recordingStream = null;

// ===== AUDIO PLAYBACK =====
let currentAudio = null;
let isSpeaking = false;

// Function to play audio from data URL (base64)
function playAudioFromDataUrl(dataUrl) {
    if (!dataUrl) {
        console.error('No audio data URL provided');
        return;
    }
    
    console.log('🔊 Playing audio from data URL');
    
    // Stop any currently playing audio
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    
    // Create audio element
    const audio = new Audio(dataUrl);
    currentAudio = audio;
    
    audio.onplay = () => {
        console.log('🎵 Audio playback started');
        isSpeaking = true;
    };
    
    audio.onended = () => {
        console.log('✅ Audio playback ended');
        isSpeaking = false;
        currentAudio = null;
    };
    
    audio.onerror = (event) => {
        console.error('Audio playback error:', event);
        isSpeaking = false;
        currentAudio = null;
        alert('⚠️ Audio playback failed. Please check your browser settings.');
    };
    
    // Play the audio
    audio.play().catch(error => {
        console.error('Failed to play audio:', error);
        isSpeaking = false;
        currentAudio = null;
    });
}

// ===== MESSAGE HANDLING =====
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

    // Determine if this is a voice input
    const isVoiceMessage = messageText !== null;
    
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
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: userMessage,
                history: chatHistory,
                voice: getSelectedVoice()
            }),
        });

        const data = await response.json();
        
        // Remove typing indicator
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) typingIndicator.remove();

        if (data.error) {
            addMessage('Error', data.error);
        } else {
            const botMessage = data.reply;
            addMessage('IELTS Bot', botMessage);
            chatHistory.push({ role: 'model', parts: [{ text: botMessage }] });
            
            // ONLY play audio if this was a VOICE input (not text input)
            if (isVoiceMessage && data.audio_url) {
                console.log('🎙️ Playing response with voice:', data.voice_used);
                playAudioFromDataUrl(data.audio_url);
            } else {
                console.log('ℹ️ Text input - no audio playback');
            }
        }

    } catch (error) {
        console.error('Fetch Error:', error);
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) typingIndicator.remove();
        addMessage('Error', 'Could not connect to the server.');
    } finally {
        // Re-enable input
        isProcessing = false;
        messageInput.disabled = false;
        sendButton.disabled = false;
        micButton.disabled = false;
        messageInput.focus();
    }
}

// ===== VOICE RECORDING FUNCTIONS =====
function handleRecordingStart() {
    console.log('🎤 Starting recording...');
    
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            recordingStream = stream;
            audioChunks = [];
            
            mediaRecorder = new MediaRecorder(stream);
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };
            
            mediaRecorder.onstop = handleRecordingStop;
            
            mediaRecorder.onerror = (event) => {
                console.error('❌ MediaRecorder error:', event.error);
                cleanupRecording();
            };
            
            mediaRecorder.start();
            
            // Update UI
            micButton.classList.add('recording');
            micButton.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
            recordingStatus.classList.add('show');
            sendButton.disabled = true;
            messageInput.disabled = true;
            
            if (navigator.vibrate) {
                navigator.vibrate(100);
            }
            
        })
        .catch(err => {
            console.error('❌ Microphone error:', err);
            alert('Could not access microphone. Please check permissions.');
            cleanupRecording();
        });
}

function handleRecordingStop() {
    console.log('🛑 Stopping recording...');
    
    // Update UI
    micButton.classList.remove('recording');
    micButton.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="23"/>
          <line x1="8" y1="23" x2="16" y2="23"/>
        </svg>`;
    recordingStatus.classList.remove('show');
    
    if (navigator.vibrate) {
        navigator.vibrate([50, 50, 50]);
    }
    
    // Stop all media tracks
    if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
        recordingStream = null;
    }
    
    // Check if we have audio data
    if (audioChunks.length === 0) {
        addMessage('Error', 'No audio recorded. Please hold the button longer.');
        sendButton.disabled = false;
        messageInput.disabled = false;
        return;
    }
    
    // Create blob and send
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    
    if (audioBlob.size < 1000) {
        addMessage('Error', 'Recording too short. Please speak longer.');
        sendButton.disabled = false;
        messageInput.disabled = false;
        return;
    }
    
    // Send to server
    sendVoiceMessage(audioBlob);
}

async function sendVoiceMessage(audioBlob) {
    addMessage('You', '🎙️ Voice message');
    
    // Show typing indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'typing-indicator';
    typingDiv.id = 'typing-indicator';
    typingDiv.innerHTML = `<span></span><span></span><span></span>`;
    chatBox.appendChild(typingDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
    
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('voice', getSelectedVoice());

    console.log('📤 Sending audio to server...');
    
    try {
        const response = await fetch(backendUrl, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Remove typing indicator
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) typingIndicator.remove();
        
        if (data.error) {
            const errorMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
            addMessage('Error', errorMsg);
            console.error('API Error:', data);
        } else if (data.reply) {
            addMessage('IELTS Bot', data.reply);
            
            // Log TTS info if available
            if (data.tts_info) {
                console.log('🔊 TTS Info:', data.tts_info);
                console.log('✅ Voice confirmed:', data.voice_used);
            }
            
            // Since this is a voice input, always respond with voice
            if (data.audio_url) {
                console.log('🎙️ Playing response audio with voice:', data.voice_used);
                playAudioFromDataUrl(data.audio_url);
            } else {
                console.warn('⚠️ No audio URL in response');
            }
        } else {
            addMessage('Error', 'No response received from server');
        }
        
    } catch (err) {
        console.error('❌ Send error:', err);
        // Remove typing indicator
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) typingIndicator.remove();
        addMessage('Error', `Failed to process voice message: ${err.message}`);
    } finally {
        // Re-enable input
        sendButton.disabled = false;
        messageInput.disabled = false;
        messageInput.focus();
    }
}

function cleanupRecording() {
    if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
        recordingStream = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    micButton.classList.remove('recording');
    micButton.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="23"/>
          <line x1="8" y1="23" x2="16" y2="23"/>
        </svg>`;
    recordingStatus.classList.remove('show');
    sendButton.disabled = false;
    messageInput.disabled = false;
    audioChunks = [];
}

// ===== EVENT LISTENERS =====
sendButton.addEventListener('click', () => sendMessage());

messageInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Mouse events for desktop
micButton.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handleRecordingStart();
});

micButton.addEventListener('mouseup', (e) => {
    e.preventDefault();
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
});

micButton.addEventListener('mouseleave', (e) => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
});

// Touch events for mobile
micButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    handleRecordingStart();
});

micButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
});

// Prevent context menu on long press
micButton.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

// Initial greeting
console.log('🚀 Chat initialized');
addMessage('IELTS Bot', 'Hello! How can I help you prepare for your IELTS exam today?');

// Voice selection change handler
voiceSelect.addEventListener('change', function() {
    const selectedVoice = voiceSelect.value;
    console.log('🎙️ Voice selected:', selectedVoice);
    
    if (selectedVoice) {
        localStorage.setItem('selectedVoice', selectedVoice);
        console.log('💾 Voice preference saved');
    } else {
        localStorage.removeItem('selectedVoice');
    }
});

// Load saved voice preference
window.addEventListener('DOMContentLoaded', function() {
    const savedVoice = localStorage.getItem('selectedVoice');
    if (savedVoice && voiceSelect) {
        voiceSelect.value = savedVoice;
        console.log('✅ Loaded saved voice preference:', savedVoice);
    }
});

// Function to get selected voice
function getSelectedVoice() {
    const selectedVoice = voiceSelect.value;
    const voice = selectedVoice || 'emma';
    return voice;
}