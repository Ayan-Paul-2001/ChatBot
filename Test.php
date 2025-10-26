<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    exit(0);
}

// Configuration
$apiKey = "AIzaSyDjvv0KDJ-ZAuv4f9neMitxLAZ2nCrax0w";
$geminiApiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=" . $apiKey;

// Google Translate TTS Voice configurations
$googleTTSVoices = [
    'emma' => ['lang' => 'en-us', 'name' => 'Emma - US Female', 'speed' => 1.0],
    'james' => ['lang' => 'en-gb', 'name' => 'James - UK Male', 'speed' => 0.95],
    'olivia' => ['lang' => 'en-au', 'name' => 'Olivia - Australian Female', 'speed' => 1.0],
    'noah' => ['lang' => 'en-ca', 'name' => 'Noah - Canadian Male', 'speed' => 0.95],
    'sophia' => ['lang' => 'en-in', 'name' => 'Sophia - Indian Female', 'speed' => 1.0],
    'william' => ['lang' => 'en-ie', 'name' => 'William - Irish Male', 'speed' => 0.95],
    'ava' => ['lang' => 'en-za', 'name' => 'Ava - South African Female', 'speed' => 1.0],
    'oliver' => ['lang' => 'en-nz', 'name' => 'Oliver - New Zealand Male', 'speed' => 0.95],
];

// Default voice
$defaultVoice = 'emma';

/**
 * Clean text to make it sound natural when spoken with proper pauses
 */
function cleanTextForSpeech($text) {
    // Step 1: Remove all markdown formatting
    $text = preg_replace('/\*\*(.*?)\*\*/', '$1', $text); // **bold**
    $text = preg_replace('/\*(.*?)\*/', '$1', $text); // *italic*
    $text = preg_replace('/__(.*?)__/', '$1', $text); // __underline__
    $text = preg_replace('/`(.*?)`/', '$1', $text); // `code`
    $text = preg_replace('/```.*?```/s', '', $text); // ```code blocks```
    $text = preg_replace('/\[(.*?)\]\(.*?\)/', '$1', $text); // [links](url)
    $text = preg_replace('/#+\s/', '', $text); // # headers
    $text = preg_replace('/^\s*[-*+]\s+/m', '', $text); // - list items
    $text = preg_replace('/^\s*\d+\.\s+/m', '', $text); // 1. numbered lists
    
    // Step 2: Remove special symbols and characters that shouldn't be read
    $text = preg_replace('/[_*~`|<>{}[\]\\\\]/', '', $text); // Special markdown chars
    $text = preg_replace('/[:;][\)\(DPO]/', '', $text); // Emoticons :) :( :D
    $text = preg_replace('/\b(https?:\/\/[^\s]+)/i', '', $text); // URLs
    $text = preg_replace('/[@#$%^&+=]/', '', $text); // Special symbols
    
    // Step 3: Remove ALL filler words and pause words
    $fillerWords = [
        '/\b(um+|uh+|ah+|hmm+|mm+|mhm|uhm|umm+)\b/i', // um, uh, ah, hmm
        '/\b(er+|erm+|err+)\b/i', // er, erm
        '/\b(like|you know|I mean|sort of|kind of)\b/i', // conversational fillers
        '/\b(basically|actually|literally)\b/i', // overused words
        '/\s*\.\.\.\s*/', // ellipsis
    ];
    
    foreach ($fillerWords as $pattern) {
        $text = preg_replace($pattern, '', $text);
    }
    
    // Step 4: Add natural pauses using punctuation for better rhythm
    $text = preg_replace('/\s*--\s*/', ', ', $text); // em dash to comma
    $text = preg_replace('/\s*-\s*/', ', ', $text); // hyphen to comma (when used as separator)
    $text = preg_replace('/\s*;\s*/', '. ', $text); // semicolon to period for stronger pause
    
    // Step 5: Ensure proper sentence spacing for natural pauses
    $text = preg_replace('/\.+/', '.', $text); // Multiple periods to single
    $text = preg_replace('/!+/', '!', $text); // Multiple exclamations to single
    $text = preg_replace('/\?+/', '?', $text); // Multiple questions to single
    $text = preg_replace('/([.!?])\s*([A-Z])/', '$1 $2', $text); // Space after sentence end
    
    // Step 6: Add commas for natural breathing pauses in long sentences
    $text = preg_replace('/\b(however|therefore|moreover|furthermore|additionally|meanwhile)\b/i', ', $1,', $text);
    $text = preg_replace('/\b(first|second|third|finally|lastly)\b/i', '$1,', $text);
    $text = preg_replace('/\b(for example|for instance|in fact|of course)\b/i', ', $1,', $text);
    
    // Step 7: Clean up spacing and punctuation
    $text = preg_replace('/\s+/', ' ', $text); // Multiple spaces to single
    $text = preg_replace('/\s+([.,!?;:])/', '$1', $text); // Remove space before punctuation
    $text = preg_replace('/([.,!?;:])\s*([.,!?;:])/', '$1', $text); // Remove double punctuation
    $text = preg_replace('/,\s*,/', ',', $text); // Remove double commas
    
    // Step 8: Fix common pronunciation issues
    $text = str_replace('&', 'and', $text);
    $text = str_replace('%', ' percent', $text);
    $text = str_replace('$', ' dollars', $text);
    $text = str_replace('#', ' number', $text);
    
    // Step 9: Final cleanup
    $text = trim($text);
    $text = preg_replace('/^\s+|\s+$/m', '', $text); // Trim each line
    
    return $text;
}

/**
 * Convert text to speech using Google Translate TTS
 */
function googleTranslateTTS($text, $voiceConfig) {
    $cleanText = cleanTextForSpeech($text);
    $cleanText = preg_replace('/[^\p{L}\p{N}\s.,!?;:\'"\-]/u', ' ', $cleanText);
    $cleanText = preg_replace('/\s+/', ' ', trim($cleanText));
    
    if (empty($cleanText)) {
        error_log('Google TTS: Cleaned text is empty');
        return null;
    }
    
    error_log('========================================');
    error_log('Google TTS Request:');
    error_log('Voice Config: ' . json_encode($voiceConfig));
    error_log('Language Code: ' . $voiceConfig['lang']);
    error_log('Voice Name: ' . $voiceConfig['name']);
    error_log('Text Length: ' . strlen($cleanText));
    error_log('========================================');
    
    $maxChunkLength = 200;
    $sentences = preg_split('/(?<=[.!?])\s+/', $cleanText);
    $chunks = [];
    $currentChunk = '';
    
    foreach ($sentences as $sentence) {
        if (strlen($currentChunk . ' ' . $sentence) > $maxChunkLength) {
            if (!empty($currentChunk)) {
                $chunks[] = trim($currentChunk);
            }
            $currentChunk = $sentence;
        } else {
            $currentChunk .= ($currentChunk ? ' ' : '') . $sentence;
        }
    }
    
    if (!empty($currentChunk)) {
        $chunks[] = trim($currentChunk);
    }
    
    if (empty($chunks)) {
        $chunks = str_split($cleanText, $maxChunkLength);
    }
    
    error_log('Processing ' . count($chunks) . ' chunks with language: ' . $voiceConfig['lang']);
    
    $audioFiles = [];
    
    foreach ($chunks as $index => $chunk) {
        if (empty(trim($chunk))) continue;
        
        // Google Translate TTS URL with language parameter
        $ttsUrl = 'https://translate.google.com/translate_tts?' . http_build_query([
            'ie' => 'UTF-8',
            'client' => 'tw-ob',
            'tl' => $voiceConfig['lang'],
            'q' => $chunk
        ]);
        
        error_log("Chunk " . ($index + 1) . " - Lang: " . $voiceConfig['lang'] . " - Text: " . substr($chunk, 0, 50) . "...");
        
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $ttsUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Accept: */*',
            'Accept-Language: en-US,en;q=0.9',
        ]);
        
        $audioData = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        
        if ($error || $httpCode !== 200) {
            error_log("ERROR - Chunk " . ($index + 1) . ": HTTP $httpCode - $error");
            continue;
        }
        
        if (!empty($audioData) && strlen($audioData) > 100) {
            $audioFiles[] = $audioData;
            error_log("SUCCESS - Chunk " . ($index + 1) . ": " . strlen($audioData) . " bytes");
        } else {
            error_log("FAILED - Chunk " . ($index + 1) . ": empty or too small");
        }
    }
    
    if (empty($audioFiles)) {
        error_log('ERROR: No audio generated');
        return null;
    }
    
    $combinedAudio = implode('', $audioFiles);
    $audioBase64 = base64_encode($combinedAudio);
    $dataUrl = 'data:audio/mpeg;base64,' . $audioBase64;
    
    error_log('SUCCESS: Total audio size: ' . strlen($combinedAudio) . ' bytes from ' . count($audioFiles) . ' chunks');
    error_log('========================================');
    
    return [
        'url' => $dataUrl,
        'size' => strlen($combinedAudio),
        'chunks' => count($audioFiles),
        'voice' => $voiceConfig['name'],
        'language' => $voiceConfig['lang']
    ];
}

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

/**
 * CASE 1: Voice message (audio file upload)
 */
if (!empty($_FILES['audio'])) {
    error_log("========================================");
    error_log("VOICE REQUEST RECEIVED");
    error_log("POST data: " . print_r($_POST, true));
    
    $audioPath = $_FILES['audio']['tmp_name'];
    
    if (!file_exists($audioPath)) {
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

    // Get selected voice
    $selectedVoice = isset($_POST['voice']) && !empty($_POST['voice']) && isset($googleTTSVoices[$_POST['voice']]) 
        ? $_POST['voice'] 
        : $defaultVoice;
    
    error_log("Selected voice: " . $selectedVoice);
    error_log("Voice config: " . json_encode($googleTTSVoices[$selectedVoice]));

    $systemInstruction = [
        "parts" => [[
            "text" => "You are an IELTS specialist. Respond naturally without filler words (um, uh, ah, hmm). Be conversational, professional, and encouraging. Use contractions and clear sentences. Keep responses focused and helpful."
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

    $response = sendToGemini($payload, $geminiApiUrl);

    if (isset($response['error'])) {
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

    error_log("Gemini response: " . substr($reply, 0, 100));
    
    // Generate TTS
    $audioResult = googleTranslateTTS($reply, $googleTTSVoices[$selectedVoice]);
    
    echo json_encode([
        'reply' => $reply,
        'audio_url' => $audioResult ? $audioResult['url'] : null,
        'voice_used' => $selectedVoice,
        'tts_info' => $audioResult
    ]);
    exit;
}

/**
 * CASE 2: Text message (JSON body)
 */
$input = json_decode(file_get_contents('php://input'), true);
$userMessage = $input['message'] ?? '';
$chatHistory = $input['history'] ?? [];
$selectedVoice = isset($input['voice']) && !empty($input['voice']) && isset($googleTTSVoices[$input['voice']]) 
    ? $input['voice'] 
    : $defaultVoice;

error_log("========================================");
error_log("TEXT REQUEST RECEIVED");
error_log("Selected voice: " . $selectedVoice);
error_log("Voice config: " . json_encode($googleTTSVoices[$selectedVoice]));

if (empty($userMessage)) {
    echo json_encode(['error' => 'No message provided.']);
    exit;
}

$systemInstruction = [
    "parts" => [[
        "text" => "Purpose and Goals:
* Professional IELTS specialist with 20 years of experience
* Expert in all IELTS modules, especially Writing and Reading
* Students are from Bangladesh

Speaking Rules (responses will be read aloud):
1. NEVER use filler words: um, uh, ah, hmm, er
2. Write clear, natural sentences
3. Be conversational but professional
4. Use contractions: I'm, you're, don't, can't
5. Keep responses focused and helpful

Provide expert guidance, simulate tests, and give constructive feedback using official IELTS scoring descriptors."
    ]]
];

$contents = $chatHistory;
$contents[] = [
    "role" => "user",
    "parts" => [["text" => $userMessage]]
];

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

error_log("Gemini response: " . substr($botMessage, 0, 100));

// Generate TTS
$audioResult = googleTranslateTTS($botMessage, $googleTTSVoices[$selectedVoice]);

echo json_encode([
    'reply' => $botMessage,
    'audio_url' => $audioResult ? $audioResult['url'] : null,
    'voice_used' => $selectedVoice,
    'tts_info' => $audioResult
]);
?>