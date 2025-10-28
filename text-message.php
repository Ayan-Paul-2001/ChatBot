<?php
/**
 * Text Message Handler
 * 
 * This handles traditional text-based chat (non-voice)
 * Uses Gemini API for text generation only
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    exit(0);
}

// Configuration
$apiKey = "AIzaSyBlO-4b60LXzPsXRQtYISByS0JzC2dFoJg";
$geminiApiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=" . $apiKey;

/**
 * Send request to Gemini API
 */
function sendToGemini($payload, $geminiApiUrl, $maxRetries = 2) {
    $retryCount = 0;
    $retryDelay = 1;
    
    while ($retryCount <= $maxRetries) {
        if ($retryCount > 0) {
            error_log("Retry attempt {$retryCount} of {$maxRetries}");
            sleep($retryDelay);
            $retryDelay *= 2;
        }
        
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $geminiApiUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
        curl_setopt($ch, CURLOPT_POST, 1);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        curl_setopt($ch, CURLOPT_TIMEOUT, 120);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        
        $result = curl_exec($ch);
        $httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($error) {
            return ['error' => 'Connection Error: ' . $error];
        }

        $response = json_decode($result, true);
        
        if ($httpcode == 503 && isset($response['error'])) {
            if ($retryCount < $maxRetries) {
                error_log("Model overloaded. Retrying...");
                $retryCount++;
                continue;
            }
            return ['error' => 'Service temporarily unavailable. Please try again.'];
        }
        
        if ($httpcode >= 400) {
            return ['error' => 'API Error', 'status' => $httpcode, 'details' => $response];
        }
        
        return $response;
    }
}

// Get input
$input = json_decode(file_get_contents('php://input'), true);
$userMessage = $input['message'] ?? '';
$chatHistory = $input['history'] ?? [];

if (empty($userMessage)) {
    echo json_encode(['error' => 'No message provided.']);
    exit;
}

error_log("📝 Text message received: " . substr($userMessage, 0, 100));

$systemInstruction = [
    "parts" => [[
        "text" => "You are a professional IELTS specialist with 20 years of experience. You're an expert in all IELTS modules, especially Writing and Speaking. Your students are from Bangladesh.

Provide expert guidance, simulate practice tests, and give constructive feedback using official IELTS scoring descriptors. Be supportive, clear, and help students improve their skills.

Keep responses well-structured and informative."
    ]]
];

$contents = $chatHistory;
$contents[] = [
    "role" => "user",
    "parts" => [["text" => $userMessage]]
];

$tools = [
    ["googleSearch" => new stdClass()]
];

$payload = [
    "systemInstruction" => $systemInstruction,
    "contents" => $contents,
    "tools" => $tools,
    "generationConfig" => [
        "temperature" => 1,
        "topP" => 0.95,
        "topK" => 40,
        "maxOutputTokens" => 8192,
        "responseMimeType" => "text/plain"
    ]
];

$response = sendToGemini($payload, $geminiApiUrl);

if (isset($response['error'])) {
    echo json_encode($response);
    exit;
}

$botMessage = '';
if (isset($response['candidates'][0]['content']['parts'])) {
    foreach ($response['candidates'][0]['content']['parts'] as $part) {
        if (isset($part['text'])) {
            $botMessage .= $part['text'];
        }
    }
}

if (empty($botMessage)) {
    $botMessage = 'Sorry, I could not process that.';
}

error_log("✅ Response generated: " . substr($botMessage, 0, 100));

echo json_encode([
    'reply' => $botMessage
]);
?>