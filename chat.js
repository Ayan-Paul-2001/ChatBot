const chatBox = document.getElementById('chat-box');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const micButton = document.getElementById('mic-button');
const recordingStatus = document.getElementById('recording-status');
const backendUrl = 'Test.php';
let chatHistory = [];

// Loading states
let isProcessing = false;

// ===== VOICE RECORDING =====
let mediaRecorder = null;
let audioChunks = [];
let recordingStream = null;
let isVoiceInput = false; // Track if input was voice or text

// ===== TEXT-TO-SPEECH =====
let currentUtterance = null;
let isSpeaking = false;

// Check if browser supports speech synthesis
const speechSupported = 'speechSynthesis' in window;

// Load voices when they become available
let voicesLoaded = false;

function loadVoices() {
    if (voicesLoaded) return;
    
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
        voicesLoaded = true;
        console.log('🎙️ Voices loaded:', voices.map(v => v.name).join(', '));
    }
}

// Load voices on page load and when voices change
if (speechSupported) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices(); // Initial load
}

// Function to clean special symbols from text for speech synthesis
function cleanTextForSpeech(text) {
    // Remove or replace special symbols that shouldn't be read literally
    let cleanedText = text
        .replace(/\*\*(.*?)\*\*/g, '$1')          // Remove bold markers **text** -> text
        .replace(/\*(.*?)\*/g, '$1')             // Remove italic markers *text* -> text
        .replace(/_(.*?)_/g, '$1')               // Remove underline markers _text_ -> text
        .replace(/`(.*?)`/g, '$1')               // Remove code markers `text` -> text
        .replace(/\[(.*?)\]\((.*?)\)/g, '$1')  // Remove markdown links [text](url) -> text
        .replace(/\#+\s?(.*?)(\n|$)/g, '$1')    // Remove header markers # text -> text
        .replace(/\-\s/g, '')                   // Remove list markers - text -> text
        .replace(/\d+\.\s/g, '')               // Remove numbered list markers 1. text -> text
        .replace(/\<.*?\>/g, '')                // Remove HTML tags <tag>text</tag> -> text
        .replace(/\&.*?\;/g, '')               // Remove HTML entities &amp; -> 
        .replace(/\s{2,}/g, ' ');              // Collapse multiple spaces
    
    return cleanedText;
}

// Function to insert natural pauses in text for more human-like speech
function insertNaturalPauses(text) {
    // Clean text first to remove special symbols
    const cleanText = cleanTextForSpeech(text);
    
    // Add natural pauses at sentence endings and commas
    let pausedText = cleanText
        .replace(/\.(\s|$)/g, '.  ') // Longer pause after sentences
        .replace(/\,(\s|$)/g, ', ')   // Short pause after commas
        .replace(/\?(\s|$)/g, '?  ')  // Longer pause after questions
        .replace(/\!(\s|$)/g, '!  '); // Longer pause after exclamations
    
    return pausedText;
}

// Function to speak text with human-like voice
function speakText(text) {
    if (!speechSupported) {
        console.error('Speech synthesis not supported in this browser');
        return;
    }
    
    // Cancel any ongoing speech
    if (isSpeaking) {
        window.speechSynthesis.cancel();
    }
    
    // Add natural pauses to the text instead of literal pause words
    const textWithPauses = insertNaturalPauses(text);
    const utterance = new SpeechSynthesisUtterance(textWithPauses);
    utterance.lang = 'en-US';
    
    // Enhanced human-like voice settings with expressive variations
    utterance.rate = 0.92; // Slower for more thoughtful, natural pacing
    utterance.pitch = 1.15; // Higher pitch for more expressive, engaging tone
    utterance.volume = 0.85; // Softer volume for conversational intimacy
    
    // Add natural speech characteristics
    utterance.onboundary = (event) => {
        // Add subtle pauses and emphasis at natural break points
        if (event.name === 'sentence' || event.name === 'word') {
            // Small random variations to mimic human speech patterns
            const pauseVariation = Math.random() * 0.1;
            utterance.rate = 0.92 + pauseVariation;
        }
    };
    
    // Try to select a more natural-sounding voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferredVoices = [
        'Google UK English Female',
        'Google UK English Male', 
        'Microsoft David Desktop',
        'Microsoft Zira Desktop',
        'Samantha',
        'Alex',
        'Daniel',
        'Fiona',
        'Karen',
        'Moira',
        'Tessa'
    ];
    
    // Find the first available preferred voice
    const selectedVoice = voices.find(voice => 
        preferredVoices.includes(voice.name)
    );
    
    if (selectedVoice) {
        utterance.voice = selectedVoice;
        console.log('🎙️ Using voice:', selectedVoice.name);
    } else if (voices.length > 0) {
        // Fallback to any available voice
        utterance.voice = voices.find(voice => voice.lang.includes('en')) || voices[0];
        console.log('🎙️ Using fallback voice:', utterance.voice.name);
    }
    
    utterance.onstart = () => {
        isSpeaking = true;
        console.log('🔊 Speaking started with human-like voice');
    };
    
    utterance.onend = () => {
        isSpeaking = false;
        console.log('🔊 Speaking ended');
    };
    
    utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event);
        isSpeaking = false;
    };
    
    currentUtterance = utterance;
    
    // Add small delay to ensure voice selection works properly
    setTimeout(() => {
        window.speechSynthesis.speak(utterance);
    }, 100);
}

// ===== MESSAGE HANDLING =====
function addMessage(sender, message) {
    const messageElement = document.createElement('div');
    messageElement.className = sender === 'You' ? 'message user-message' : 'message bot-message';
    messageElement.innerHTML = message.replace(/\n/g, '<br>');
    
    // Add timestamp
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    messageElement.setAttribute('data-time', timestamp);
    
    chatBox.appendChild(messageElement);
    
    // Smooth scroll with easing
    setTimeout(() => {
        messageElement.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'end',
            inline: 'nearest'
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
    typingDiv.innerHTML = `
        <span></span>
        <span></span>
        <span></span>
    `;
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
                history: chatHistory
            }),
        });

        const data = await response.json();
        
        // Remove typing indicator
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) typingIndicator.remove();

        if (data.error) {
            addMessage('Error', data.error + (data.details ? `<br><pre>${JSON.stringify(data.details, null, 2)}</pre>` : ''));
        } else {
            const botMessage = data.reply;
            addMessage('IELTS Bot', botMessage);
            chatHistory.push({ role: 'model', parts: [{ text: botMessage }] });
            
            // If input was voice, respond with voice
            if (isVoiceMessage && speechSupported) {
                speakText(botMessage);
            }
        }

    } catch (error) {
        console.error('Fetch Error:', error);
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) typingIndicator.remove();
        addMessage('Error', 'Could not connect to the chatbot server.');
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
            
            // Create MediaRecorder
            mediaRecorder = new MediaRecorder(stream);
            
            mediaRecorder.ondataavailable = (event) => {
                console.log('📦 Audio data received:', event.data.size);
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };
            
            mediaRecorder.onstop = handleRecordingStop;
            
            mediaRecorder.onerror = (event) => {
                console.error('❌ MediaRecorder error:', event.error);
                cleanupRecording();
            };
            
            // Start recording
            mediaRecorder.start();
            console.log('✅ Recording started');
            
            // Update UI
            micButton.classList.add('recording');
            micButton.textContent = '⏹️';
            recordingStatus.classList.add('show');
            sendButton.disabled = true;
            messageInput.disabled = true;
            
            // Add haptic feedback if available
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
    
    // Update UI first
    micButton.classList.remove('recording');
    micButton.textContent = '🎤';
    recordingStatus.classList.remove('show');
    
    // Add haptic feedback if available
    if (navigator.vibrate) {
        navigator.vibrate([50, 50, 50]);
    }
    
    // Stop all media tracks
    if (recordingStream) {
        recordingStream.getTracks().forEach(track => {
            track.stop();
            console.log('🔇 Track stopped');
        });
        recordingStream = null;
    }
    
    // Check if we have audio data
    if (audioChunks.length === 0) {
        console.warn('⚠️ No audio chunks recorded');
        addMessage('Error', 'No audio recorded. Please hold the button longer and speak clearly.');
        sendButton.disabled = false;
        messageInput.disabled = false;
        return;
    }
    
    console.log('📊 Total audio chunks:', audioChunks.length);
    
    // Create blob and send
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    console.log('🎵 Audio blob size:', audioBlob.size, 'bytes');
    
    if (audioBlob.size < 1000) {
        console.warn('⚠️ Audio too short');
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
    typingDiv.innerHTML = `
        <span></span>
        <span></span>
        <span></span>
    `;
    chatBox.appendChild(typingDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
    
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    
    console.log('📤 Sending audio to server...');
    
    try {
        const response = await fetch(backendUrl, {
            method: 'POST',
            body: formData
        });
        
        console.log('📥 Response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('📄 Response data:', data);
        
        // Remove typing indicator
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) typingIndicator.remove();
        
        if (data.error) {
            const errorMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
            const detailsMsg = data.details ? `<br><small>${JSON.stringify(data.details)}</small>` : '';
            addMessage('Error', errorMsg + detailsMsg);
            console.error('API Error:', data);
        } else if (data.reply) {
            addMessage('IELTS Bot', data.reply);
            
            // Since this is a voice input, respond with voice
            if (speechSupported) {
                speakText(data.reply);
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
    micButton.textContent = '🎤';
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
    console.log('🖱️ Mouse down');
    handleRecordingStart();
});

micButton.addEventListener('mouseup', (e) => {
    e.preventDefault();
    console.log('🖱️ Mouse up');
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
});

micButton.addEventListener('mouseleave', (e) => {
    console.log('🖱️ Mouse leave');
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
});

// Touch events for mobile
micButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    console.log('👆 Touch start');
    handleRecordingStart();
});

micButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    console.log('👆 Touch end');
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