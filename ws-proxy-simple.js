/**
 * Improved Gemini Live API WebSocket Proxy
 * Optimized for speech-to-speech functionality
 * 
 * Setup:
 * 1. npm install ws
 * 2. node ws-proxy-improved.js
 * 3. Keep this running while using the chatbot
 */

const WebSocket = require('ws');
const http = require('http');

// ⚠️ REPLACE WITH YOUR ACTUAL API KEY
const GEMINI_API_KEY = 'AIzaSyBlO-4b60LXzPsXRQtYISByS0JzC2dFoJg';
const PORT = 8080;
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

console.log('\n═══════════════════════════════════════════════════');
console.log('  GEMINI LIVE API PROXY - SPEECH-TO-SPEECH');
console.log('═══════════════════════════════════════════════════\n');
console.log('🔐 API Key:', GEMINI_API_KEY.substring(0, 15) + '...');
console.log('🎙️  Optimized for real-time voice interaction\n');

// System instruction optimized for voice
const SYSTEM_INSTRUCTION = {
    parts: [{
        text: `You are a professional IELTS specialist with 20 years of experience. You're an expert in all IELTS modules, especially Writing and Speaking. Your students are from Bangladesh.

CRITICAL VOICE RESPONSE RULES:
1. NEVER use filler words: NO "um", "uh", "ah", "hmm", "er", "well", "you know"
2. Speak in clear, complete sentences
3. Be natural and conversational but professional
4. Use contractions: I'm, you're, don't, can't, it's
5. Keep responses concise (2-3 sentences max for simple questions)
6. For complex topics, break into digestible chunks
7. Be encouraging and supportive

Provide expert guidance, simulate practice tests, and give constructive feedback using official IELTS scoring descriptors. Focus on clarity since this will be spoken aloud.`
    }]
};

// Create HTTP server
const server = http.createServer();
const wss = new WebSocket.Server({ 
    server,
    perMessageDeflate: false // Disable compression for lower latency
});

let clientCounter = 0;

// Handle client connections
wss.on('connection', (clientWs, req) => {
    const clientId = ++clientCounter;
    const clientIP = req.socket.remoteAddress;
    
    console.log(`\n✅ [Client ${clientId}] Connected from ${clientIP}`);
    
    let geminiWs = null;
    let setupComplete = false;
    let isClosing = false;
    let audioChunksSent = 0;
    let audioChunksReceived = 0;
    let lastActivityTime = Date.now();

    // Heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
        if (clientWs.readyState === WebSocket.OPEN) {
            // Check for inactivity (30 seconds)
            if (Date.now() - lastActivityTime > 30000) {
                console.log(`⚠️ [Client ${clientId}] Inactive for 30s, keeping alive...`);
                lastActivityTime = Date.now();
            }
        }
    }, 10000); // Every 10 seconds

    try {
        // Connect to Gemini Live API
        console.log(`📡 [Client ${clientId}] Connecting to Gemini Live API...`);
        geminiWs = new WebSocket(GEMINI_WS_URL, {
            handshakeTimeout: 10000,
            perMessageDeflate: false
        });
        
        geminiWs.on('open', () => {
            console.log(`✅ [Client ${clientId}] Gemini WebSocket connected`);
            
            // Send setup message with optimized configuration
            const setupMessage = {
                setup: {
                    model: 'models/gemini-2.0-flash-exp',
                    systemInstruction: SYSTEM_INSTRUCTION,
                    generationConfig: {
                        responseModalities: ['AUDIO'], // Audio only for speech-to-speech
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: 'Aoede' // Natural voice
                                }
                            }
                        }
                    }
                }
            };
            
            geminiWs.send(JSON.stringify(setupMessage));
            console.log(`📤 [Client ${clientId}] Setup message sent`);
            
            // Notify client of successful connection
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                    type: 'connected',
                    message: 'Connected to Gemini Live API - Ready for voice'
                }));
            }
        });
        
        geminiWs.on('message', (data) => {
            lastActivityTime = Date.now();
            
            try {
                const response = JSON.parse(data.toString());
                
                // Handle setup completion
                if (response.setupComplete) {
                    setupComplete = true;
                    console.log(`✅ [Client ${clientId}] Setup complete - Ready for audio streaming`);
                    return;
                }
                
                // Handle server content
                if (response.serverContent) {
                    const content = response.serverContent;
                    
                    // Handle model turn (audio/text response)
                    if (content.modelTurn && content.modelTurn.parts) {
                        for (const part of content.modelTurn.parts) {
                            // Audio data
                            if (part.inlineData && part.inlineData.data) {
                                audioChunksReceived++;
                                
                                if (clientWs.readyState === WebSocket.OPEN) {
                                    clientWs.send(JSON.stringify({
                                        type: 'audio',
                                        data: part.inlineData.data
                                    }));
                                    
                                    if (audioChunksReceived % 5 === 0) {
                                        console.log(`📥 [Client ${clientId}] Audio chunk #${audioChunksReceived} forwarded`);
                                    }
                                }
                            }
                            
                            // Text data (transcription or text response)
                            if (part.text) {
                                console.log(`📝 [Client ${clientId}] Text: ${part.text.substring(0, 80)}...`);
                                
                                if (clientWs.readyState === WebSocket.OPEN) {
                                    clientWs.send(JSON.stringify({
                                        type: 'text',
                                        text: part.text
                                    }));
                                }
                            }
                        }
                    }
                    
                    // Handle turn complete
                    if (content.turnComplete) {
                        console.log(`✅ [Client ${clientId}] Turn complete (Sent: ${audioChunksSent}, Received: ${audioChunksReceived})`);
                        
                        if (clientWs.readyState === WebSocket.OPEN) {
                            clientWs.send(JSON.stringify({
                                type: 'turnComplete'
                            }));
                        }
                        
                        // Reset counters
                        audioChunksSent = 0;
                        audioChunksReceived = 0;
                    }
                    
                    // Handle user turn (user speaking detected)
                    if (content.interrupted) {
                        console.log(`⚠️ [Client ${clientId}] User interrupted AI`);
                    }
                }
                
                // Handle errors from Gemini
                if (response.error) {
                    console.error(`❌ [Client ${clientId}] Gemini error:`, response.error);
                    
                    if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({
                            type: 'error',
                            error: response.error.message || 'Unknown error from Gemini'
                        }));
                    }
                }
                
            } catch (err) {
                console.error(`❌ [Client ${clientId}] Message parse error:`, err.message);
            }
        });
        
        geminiWs.on('error', (err) => {
            console.error(`❌ [Client ${clientId}] Gemini WebSocket error:`, err.message);
            
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                    type: 'error',
                    error: 'Gemini API error: ' + err.message
                }));
            }
        });
        
        geminiWs.on('close', (code, reason) => {
            console.log(`🔌 [Client ${clientId}] Gemini connection closed (${code}): ${reason}`);
            
            if (!isClosing && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                    type: 'error',
                    error: 'Gemini connection closed unexpectedly'
                }));
            }
        });
        
    } catch (err) {
        console.error(`❌ [Client ${clientId}] Failed to connect to Gemini:`, err.message);
        
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
                type: 'error',
                error: 'Failed to connect to Gemini: ' + err.message
            }));
            clientWs.close();
        }
        return;
    }
    
    // Handle messages from client (browser)
    clientWs.on('message', (data) => {
        lastActivityTime = Date.now();
        
        try {
            const message = JSON.parse(data.toString());
            
            // Wait for setup to complete before processing audio
            if (!setupComplete) {
                console.log(`⏳ [Client ${clientId}] Waiting for setup... (message type: ${message.type})`);
                return;
            }
            
            // Handle audio input from user
            if (message.type === 'audio' && message.data) {
                audioChunksSent++;
                
                // Forward audio to Gemini with proper format
                const geminiMessage = {
                    realtimeInput: {
                        mediaChunks: [{
                            mimeType: message.mimeType || 'audio/pcm;rate=16000',
                            data: message.data
                        }]
                    }
                };
                
                if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                    geminiWs.send(JSON.stringify(geminiMessage));
                    
                    // Log periodically to avoid spam
                    if (audioChunksSent % 20 === 0) {
                        console.log(`📤 [Client ${clientId}] Forwarded ${audioChunksSent} audio chunks to Gemini`);
                    }
                } else {
                    console.warn(`⚠️ [Client ${clientId}] Gemini not ready (state: ${geminiWs?.readyState})`);
                }
            }
            
            // Handle text input (if needed for debugging)
            else if (message.type === 'text' && message.text) {
                console.log(`📝 [Client ${clientId}] Text input: ${message.text}`);
                
                const geminiMessage = {
                    clientContent: {
                        turns: [{
                            role: 'user',
                            parts: [{ text: message.text }]
                        }],
                        turnComplete: true
                    }
                };
                
                if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                    geminiWs.send(JSON.stringify(geminiMessage));
                }
            }
            
        } catch (err) {
            console.error(`❌ [Client ${clientId}] Client message error:`, err.message);
        }
    });
    
    // Handle client disconnection
    clientWs.on('close', (code, reason) => {
        isClosing = true;
        console.log(`🔌 [Client ${clientId}] Client disconnected (${code}): ${reason || 'No reason'}`);
        
        // Clean up
        clearInterval(heartbeatInterval);
        
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.close();
        }
        
        console.log(`📊 [Client ${clientId}] Stats - Sent: ${audioChunksSent} chunks, Received: ${audioChunksReceived} chunks`);
    });
    
    // Handle client errors
    clientWs.on('error', (err) => {
        console.error(`❌ [Client ${clientId}] Client WebSocket error:`, err.message);
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`✅ WebSocket Proxy Server running on ws://localhost:${PORT}`);
    console.log(`📡 Proxying to Gemini Live API`);
    console.log(`🎙️  Speech-to-Speech mode enabled\n`);
    console.log('═══════════════════════════════════════════════════');
    console.log('📋 SETUP INSTRUCTIONS:');
    console.log('   1. Keep this terminal running');
    console.log('   2. Start your web server (XAMPP/php -S localhost:8000)');
    console.log('   3. Open browser: http://localhost:8000/');
    console.log('   4. Hold microphone button and speak');
    console.log('   5. AI will respond with voice\n');
    console.log('💡 TIPS:');
    console.log('   - Speak clearly and naturally');
    console.log('   - Release button when done speaking');
    console.log('   - Wait for AI to finish before speaking again');
    console.log('   - Check browser console (F12) for debugging\n');
    console.log('Press Ctrl+C to stop the server');
    console.log('═══════════════════════════════════════════════════\n');
});

// Handle server errors
server.on('error', (err) => {
    console.error('\n❌ SERVER ERROR:', err.message);
    
    if (err.code === 'EADDRINUSE') {
        console.error(`\n⚠️  Port ${PORT} is already in use!`);
        console.error('Solutions:');
        console.error('  1. Stop the other process using this port');
        console.error('  2. Or change PORT in this file (line 16)\n');
    }
    
    process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down proxy server...');
    
    // Close all client connections
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.close(1000, 'Server shutting down');
        }
    });
    
    // Close server
    server.close(() => {
        console.log('✅ Server stopped gracefully');
        process.exit(0);
    });
    
    // Force exit after 5 seconds
    setTimeout(() => {
        console.log('⚠️  Forcing exit...');
        process.exit(0);
    }, 5000);
});

process.on('uncaughtException', (err) => {
    console.error('\n❌ UNCAUGHT EXCEPTION:', err);
    console.error('Stack:', err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n❌ UNHANDLED REJECTION:', reason);
});