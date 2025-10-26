<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    exit(0);
}

// Configuration
$apiKey = "AIzaSyCHfERgHR-JfZUUx4tRMzM2Z0YViT8sjqs";
$geminiApiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=" . $apiKey;

/**
 * Send request to Gemini API with retry mechanism
 */
function sendToGemini($payload, $geminiApiUrl, $maxRetries = 2) {
    $retryCount = 0;
    $retryDelay = 1; // Start with 1 second delay
    
    while ($retryCount <= $maxRetries) {
        // If this is a retry, log it and wait
        if ($retryCount > 0) {
            error_log("Retry attempt {$retryCount} of {$maxRetries} after {$retryDelay} seconds");
            sleep($retryDelay);
            // Exponential backoff - double the delay for next retry
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
            error_log("CURL Error: " . $error);
            // Don't retry on connection errors
            return ['error' => 'Connection Error: ' . $error];
        }

        $response = json_decode($result, true);
        
        // Check for retryable errors (503 - service unavailable)
        if ($httpcode == 503 && isset($response['error']) && 
            (strpos($response['error']['message'], 'overloaded') !== false || 
             strpos($response['error']['message'], 'unavailable') !== false)) {
            
            // If we have retries left, continue to next iteration
            if ($retryCount < $maxRetries) {
                error_log("Model overloaded (503). Retrying...");
                $retryCount++;
                continue;
            }
            
            // Out of retries, return friendly error
            return [
                'error' => 'The AI service is currently experiencing high demand. Please try again in a few moments.',
                'status' => $httpcode,
                'retry' => true,
                'details' => $response
            ];
        }
        
        // For any other error, don't retry
        if ($httpcode >= 400) {
            error_log("API Error - Status: " . $httpcode . ", Response: " . $result);
            return ['error' => 'API Error', 'status' => $httpcode, 'details' => $response];
        }
        
        // Success! Return the response
        return $response;
    }
}

/**
 * CASE 1: Voice message (audio file upload)
 */
if (!empty($_FILES['audio'])) {
    error_log("Voice request received");
    error_log("Files: " . print_r($_FILES, true));
    
    $audioPath = $_FILES['audio']['tmp_name'];
    
    if (!file_exists($audioPath)) {
        error_log("Audio file not found at: " . $audioPath);
        echo json_encode(['error' => 'Audio file not received']);
        exit;
    }
    
    $fileSize = filesize($audioPath);
    error_log("Audio file size: " . $fileSize . " bytes");
    
    if ($fileSize < 100) {
        echo json_encode(['error' => 'Audio file too small']);
        exit;
    }
    
    $audioData = base64_encode(file_get_contents($audioPath));
    error_log("Audio encoded, length: " . strlen($audioData));

    // System instruction for voice processing - natural human conversation with proper pauses
    $systemInstruction = [
        "parts" => [[
            "text" => "You are an IELTS specialist with a natural, human conversational style. When responding to voice messages:

IMPORTANT: DO NOT literally say pause words like 'um', 'uh', 'ah', or 'hmm'. Instead, use natural pauses in your speech.

1. Use natural pacing with brief pauses between thoughts - this creates the feeling of thinking
2. Vary your speech rhythm - sometimes speak faster when excited, slower when explaining complex ideas
3. Use expressive language naturally: 'that's interesting', 'great question', 'let me think about that'
4. Include natural conversational flow: 'you know', 'I mean', 'actually', 'basically'
5. Add warmth and personality through your tone - sound engaged and interested
6. Use contractions heavily: I'm, you're, don't, can't, won't, it's, that's
7. Sound spontaneous - like you're thinking and responding in real time
8. For IELTS questions, provide clear guidance but keep it conversational
9. Use emphasis on important words naturally through your tone
10. Occasionally rephrase for clarity: 'What I mean is...', 'In other words...'

Focus on natural speech patterns with appropriate pauses, not literal pause words."
        ]]
    ];

    $payload = [
        "systemInstruction" => $systemInstruction,
        "contents" => [[
            "role" => "user",
            "parts" => [[
                "inline_data" => [
                    "mime_type" => "audio/webm",
                    "data" => $audioData
                ]
            ]]
        ]],
        "generationConfig" => [
            "temperature" => 0.7,
            "topP" => 0.9,
            "topK" => 40,
            "maxOutputTokens" => 2048
        ]
    ];

    error_log("Sending payload to Gemini API...");

    $response = sendToGemini($payload, $geminiApiUrl);

    if (isset($response['error'])) {
        error_log("Gemini API error: " . print_r($response, true));
        echo json_encode($response);
        exit;
    }

    $reply = '';
    if (isset($response['candidates'][0]['content']['parts'])) {
        foreach ($response['candidates'][0]['content']['parts'] as $part) {
            if (isset($part['text'])) {
                $reply .= $part['text'];
            }
        }
    }

    if (empty($reply)) {
        $reply = 'Sorry, I couldn\'t process your voice input.';
    }

    error_log("Voice response: " . substr($reply, 0, 100));
    echo json_encode(['reply' => $reply]);
    exit;
}

/**
 * CASE 2: Text message (JSON body)
 */
$input = json_decode(file_get_contents('php://input'), true);
$userMessage = $input['message'] ?? '';
$chatHistory = $input['history'] ?? [];

if (empty($userMessage)) {
    echo json_encode(['error' => 'No message provided.']);
    exit;
}

// System instruction for text chat
$systemInstruction = [
    "parts" => [[
        "text" => "Purpose and Goals:
* Serve as a professional IELTS specialist, teacher, and examiner with 20 years of experience.
* Possess comprehensive and up-to-date knowledge of all aspects of the IELTS exam.
* Provide expert guidance and practice for all four modules, especially Writing and Reading.
* All students are from Bangladesh – localize all examples, feedback, and references accordingly.

Behaviors and Rules:
1) Be expert, professional, and supportive.
2) Ask diagnostic questions to tailor sessions.
3) Simulate IELTS tests, evaluate responses, and give constructive feedback.
4) Use academic and precise language.
5) Reference official IELTS scoring descriptors.
6) When generating test tasks, pull questions directly from this document:
   https://docs.google.com/document/d/1qy9QzD5fqGHuRG5XgUHKXWsI_yeVdiLafcSwMo3cuZg/edit?usp=sharing"
    ]]
];

// Build conversation contents
$contents = $chatHistory;
$contents[] = [
    "role" => "user",
    "parts" => [["text" => $userMessage]]
];

// Tools configuration
$tools = [
    ["urlContext" => new stdClass()],
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
        "responseMimeType" => "text/plain",
        "thinkingConfig" => [
            "thinkingBudget" => -1
        ]
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

echo json_encode(['reply' => $botMessage]);
?>