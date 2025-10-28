<?php
/**
 * Gemini Live API WebSocket Proxy - Complete PHP Implementation
 * 
 * Setup Instructions:
 * 1. Install dependencies: composer install
 * 2. Configure your API key below (line 25)
 * 3. Run: php ws-proxy.php
 * 4. Keep this terminal open while using the chatbot
 */

require __DIR__ . '/vendor/autoload.php';

use Ratchet\MessageComponentInterface;
use Ratchet\ConnectionInterface;
use Ratchet\Server\IoServer;
use Ratchet\Http\HttpServer;
use Ratchet\WebSocket\WsServer;
use WebSocket\Client as WebSocketClient;
use React\EventLoop\Loop;

// ===== CONFIGURATION =====
// ⚠️ REPLACE WITH YOUR ACTUAL GEMINI API KEY
$GEMINI_API_KEY = "AIzaSyBlO-4b60LXzPsXRQtYISByS0JzC2dFoJg";

if ($GEMINI_API_KEY === "AIzaSyBlO-4b60LXzPsXRQtYISByS0JzC2dFoJg") {
    die("❌ ERROR: Please set your Gemini API key in ws-proxy.php (line 25)\n");
}

// Gemini Live API WebSocket URL
$GEMINI_WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=" . $GEMINI_API_KEY;

// System instruction for IELTS Bot
$SYSTEM_INSTRUCTION = [
    "parts" => [[
        "text" => "You are a professional IELTS specialist with 20 years of experience. You're an expert in all IELTS modules, especially Writing and Speaking. Your students are from Bangladesh.

When speaking (since responses will be converted to voice):
1. NEVER use filler words like um, uh, ah, hmm, er
2. Speak in clear, natural sentences
3. Be conversational but professional
4. Use contractions naturally: I'm, you're, don't, can't
5. Keep responses focused, helpful, and encouraging

Provide expert guidance, simulate practice tests, and give constructive feedback using official IELTS scoring descriptors."
    ]]
];

/**
 * Gemini Live Proxy Handler Class
 */
class GeminiLiveProxy implements MessageComponentInterface {
    protected $clients;
    protected $geminiClients;
    protected $apiUrl;
    protected $systemInstruction;
    protected $loop;

    public function __construct($apiUrl, $systemInstruction) {
        $this->clients = new \SplObjectStorage;
        $this->geminiClients = [];
        $this->apiUrl = $apiUrl;
        $this->systemInstruction = $systemInstruction;
        $this->loop = Loop::get();
        
        echo "🚀 Gemini Live Proxy Server initialized\n";
        echo "🔐 Using API key: " . substr($apiUrl, -20) . "\n";
    }

    /**
     * Called when a new client connects
     */
    public function onOpen(ConnectionInterface $conn) {
        $this->clients->attach($conn);
        $clientId = $conn->resourceId;
        
        echo "\n✅ New client connected: {$clientId}\n";

        try {
            // Create WebSocket connection to Gemini Live API
            $geminiClient = new WebSocketClient($this->apiUrl, [
                'timeout' => 300, // 5 minute timeout
                'persistent' => true,
                'headers' => [
                    'Content-Type' => 'application/json'
                ]
            ]);
            
            echo "📡 Connected to Gemini Live API for client {$clientId}\n";
            
            // Store the Gemini connection
            $this->geminiClients[$clientId] = [
                'ws' => $geminiClient,
                'conn' => $conn,
                'setupComplete' => false
            ];
            
            // Send setup message to Gemini
            $setupMessage = [
                "setup" => [
                    "model" => "models/gemini-2.0-flash-exp",
                    "systemInstruction" => $this->systemInstruction,
                    "generationConfig" => [
                        "responseModalities" => ["AUDIO"],
                        "speechConfig" => [
                            "voiceConfig" => [
                                "prebuiltVoiceConfig" => [
                                    "voiceName" => "Aoede"
                                ]
                            ]
                        ]
                    ]
                ]
            ];
            
            $geminiClient->text(json_encode($setupMessage));
            echo "📤 Setup message sent to Gemini for client {$clientId}\n";
            
            // Start async listener for Gemini responses
            $this->startGeminiListener($clientId);
            
            // Notify client that connection is ready
            $conn->send(json_encode([
                'type' => 'connected',
                'message' => 'Connected to Gemini Live API'
            ]));
            
        } catch (\Exception $e) {
            echo "❌ Error connecting to Gemini: {$e->getMessage()}\n";
            $conn->send(json_encode([
                'type' => 'error',
                'error' => 'Failed to connect to Gemini API: ' . $e->getMessage()
            ]));
            $conn->close();
        }
    }

    /**
     * Called when client sends a message
     */
    public function onMessage(ConnectionInterface $from, $msg) {
        $clientId = $from->resourceId;
        
        try {
            $data = json_decode($msg, true);
            
            if (!$data || !isset($data['type'])) {
                echo "⚠️ Invalid message format from client {$clientId}\n";
                return;
            }
            
            // Check if setup is complete
            if (!isset($this->geminiClients[$clientId])) {
                echo "⚠️ No Gemini connection for client {$clientId}\n";
                return;
            }
            
            if (!$this->geminiClients[$clientId]['setupComplete']) {
                echo "⏳ Waiting for setup completion for client {$clientId}\n";
                return;
            }
            
            // Handle audio message
            if ($data['type'] === 'audio') {
                $geminiMessage = [
                    "realtimeInput" => [
                        "mediaChunks" => [[
                            "mimeType" => $data['mimeType'] ?? "audio/pcm;rate=16000",
                            "data" => $data['data']
                        ]]
                    ]
                ];
                
                $this->geminiClients[$clientId]['ws']->text(json_encode($geminiMessage));
                echo "📤 Audio chunk forwarded to Gemini for client {$clientId}\n";
            }
            
        } catch (\Exception $e) {
            echo "❌ Error processing message from client {$clientId}: {$e->getMessage()}\n";
            $from->send(json_encode([
                'type' => 'error',
                'error' => 'Failed to process message'
            ]));
        }
    }

    /**
     * Start listening for Gemini responses (async)
     */
    protected function startGeminiListener($clientId) {
        // Use React EventLoop for async operations
        $this->loop->addPeriodicTimer(0.05, function() use ($clientId) {
            if (!isset($this->geminiClients[$clientId])) {
                return; // Client disconnected
            }
            
            $geminiClient = $this->geminiClients[$clientId]['ws'];
            $clientConn = $this->geminiClients[$clientId]['conn'];
            
            try {
                // Try to receive message from Gemini (non-blocking)
                $geminiClient->setTimeout(0.01); // 10ms timeout for non-blocking
                $response = $geminiClient->receive();
                
                if (!$response) {
                    return; // No message available
                }
                
                $data = json_decode($response, true);
                
                // Handle setup completion
                if (isset($data['setupComplete']) && $data['setupComplete']) {
                    $this->geminiClients[$clientId]['setupComplete'] = true;
                    echo "✅ Setup complete for client {$clientId}\n";
                    return;
                }
                
                // Handle server content
                if (isset($data['serverContent'])) {
                    $content = $data['serverContent'];
                    
                    // Audio/text response from model
                    if (isset($content['modelTurn']['parts'])) {
                        foreach ($content['modelTurn']['parts'] as $part) {
                            // Audio data
                            if (isset($part['inlineData']['data'])) {
                                $clientConn->send(json_encode([
                                    'type' => 'audio',
                                    'data' => $part['inlineData']['data']
                                ]));
                                echo "📥 Audio chunk sent to client {$clientId}\n";
                            }
                            
                            // Text data
                            if (isset($part['text'])) {
                                $clientConn->send(json_encode([
                                    'type' => 'text',
                                    'text' => $part['text']
                                ]));
                                echo "📝 Text sent to client {$clientId}: " . substr($part['text'], 0, 50) . "...\n";
                            }
                        }
                    }
                    
                    // Turn complete
                    if (isset($content['turnComplete']) && $content['turnComplete']) {
                        $clientConn->send(json_encode([
                            'type' => 'turnComplete'
                        ]));
                        echo "✅ Turn complete for client {$clientId}\n";
                    }
                }
                
            } catch (\WebSocket\TimeoutException $e) {
                // Timeout is normal for non-blocking receive
                return;
            } catch (\Exception $e) {
                if (strpos($e->getMessage(), 'timeout') === false) {
                    echo "⚠️ Gemini listener error for client {$clientId}: {$e->getMessage()}\n";
                }
            }
        });
    }

    /**
     * Called when client disconnects
     */
    public function onClose(ConnectionInterface $conn) {
        $clientId = $conn->resourceId;
        $this->clients->detach($conn);
        
        // Close Gemini connection
        if (isset($this->geminiClients[$clientId])) {
            try {
                $this->geminiClients[$clientId]['ws']->close();
            } catch (\Exception $e) {
                // Ignore close errors
            }
            unset($this->geminiClients[$clientId]);
        }
        
        echo "🔌 Client {$clientId} disconnected\n";
    }

    /**
     * Called on connection error
     */
    public function onError(ConnectionInterface $conn, \Exception $e) {
        $clientId = $conn->resourceId;
        echo "❌ Error on connection {$clientId}: {$e->getMessage()}\n";
        $conn->close();
    }
}

// ===== START SERVER =====
$port = 8080;

echo "\n";
echo "╔════════════════════════════════════════════════════════════╗\n";
echo "║     GEMINI LIVE API WEBSOCKET PROXY SERVER (PHP)          ║\n";
echo "╚════════════════════════════════════════════════════════════╝\n";
echo "\n";
echo "🌐 Starting server on port: {$port}\n";
echo "📡 Gemini API URL: " . substr($GEMINI_WS_URL, 0, 80) . "...\n";
echo "\n";

try {
    $server = IoServer::factory(
        new HttpServer(
            new WsServer(
                new GeminiLiveProxy($GEMINI_WS_URL, $SYSTEM_INSTRUCTION)
            )
        ),
        $port
    );
    
    echo "✅ Server is running!\n";
    echo "\n";
    echo "📋 Next steps:\n";
    echo "   1. Open another terminal\n";
    echo "   2. Run: php -S localhost:8000\n";
    echo "   3. Open browser: http://localhost:8000\n";
    echo "   4. Hold mic button and speak!\n";
    echo "\n";
    echo "Press Ctrl+C to stop the server\n";
    echo "\n";
    echo "════════════════════════════════════════════════════════════\n\n";
    
    $server->run();
    
} catch (\Exception $e) {
    echo "\n❌ FATAL ERROR: {$e->getMessage()}\n";
    echo "\nTroubleshooting:\n";
    echo "  - Check if port {$port} is already in use\n";
    echo "  - Verify composer dependencies are installed: composer install\n";
    echo "  - Ensure your API key is valid\n\n";
    exit(1);
}
?>