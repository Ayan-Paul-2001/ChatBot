// backend/routes/voiceChat.js

const express = require('express');
const router = express.Router();
const { OpenAI } = require('openai');
require('dotenv').config();
const verifyToken = require('../middleware/auth');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

router.post('/voice-message', verifyToken, async (req, res) => {
    const { message, thread_id: incomingThreadId } = req.body;

    if (!message || !message.trim()) {
        return res.status(400).json({
            success: false,
            message: 'Message is required.'
        });
    }

    try {
        // Reuse existing thread or create new one (same logic as chat)
        let threadId = incomingThreadId;
        if (!threadId || threadId === 'undefined' || threadId === 'null') {
            const thread = await openai.beta.threads.create();
            threadId = thread.id;
        }

        // Add user message to thread
        await openai.beta.threads.messages.create(threadId, {
            role: 'user',
            content: message
        });

        // Run the assistant
        const run = await openai.beta.threads.runs.create(threadId, {
            assistant_id: process.env.OPENAI_ASSISTANT_ID
        });

        // Poll for completion
        let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
        let attempts = 0;
        const maxAttempts = 30;

        while (runStatus.status !== 'completed' && attempts < maxAttempts) {
            if (runStatus.status === 'failed' || runStatus.status === 'cancelled') {
                throw new Error(`Assistant run failed with status: ${runStatus.status}`);
            }
            await new Promise((r) => setTimeout(r, 1000));
            runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
            attempts++;
        }

        if (runStatus.status !== 'completed') {
            throw new Error('Assistant run timed out');
        }

        // Get assistant's response
        const messagesResponse = await openai.beta.threads.messages.list(threadId, {
            limit: 1,
            order: 'desc'
        });

        const assistantMessage = messagesResponse.data.find(msg => msg.role === 'assistant');
        if (!assistantMessage) {
            throw new Error('No assistant message found in thread');
        }

        // Extract text content
        let rawReply = '';
        if (assistantMessage.content && assistantMessage.content.length > 0) {
            assistantMessage.content.forEach(contentItem => {
                if (contentItem.type === 'text' && contentItem.text) {
                    rawReply += contentItem.text.value;
                }
            });
        }

        if (!rawReply) {
            rawReply = "I'm sorry, I couldn't generate a response. Please try again.";
        }

        // Clean the response (use same logic as chat)
        let cleanReply = rawReply;

        if (rawReply.includes('{') && rawReply.includes('}')) {
            try {
                const jsonMatch = rawReply.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    const contentParts = new Set();

                    Object.entries(parsed).forEach(([key, value]) => {
                        if (['response_type', 'next_action', 'date', 'note', 'conditions',
                            'triage_step', 'consent_obtained', 'red_flag_screening',
                            'general_questions', 'subjective_assessment', 'region_specific_followup',
                            'triage_complete', 'question', 'options', 'video_url', 'advice'].includes(key)) {
                            return;
                        }

                        if (typeof value === 'string' && value.trim()) {
                            contentParts.add(value.trim());
                        } else if (value && typeof value === 'object' && value.text) {
                            contentParts.add(value.text.trim());
                        }
                    });

                    if (parsed.question) {
                        if (typeof parsed.question === 'string') {
                            contentParts.add(parsed.question.trim());
                        } else if (parsed.question.text) {
                            contentParts.add(parsed.question.text.trim());
                        }
                    }

                    cleanReply = Array.from(contentParts).join(' ');
                }
            } catch (e) {
            }
        }

        cleanReply = cleanReply
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .replace(/json/g, '')
            .replace(/response_type:\s*\w+/gi, '')
            .replace(/next_action:\s*\w+/gi, '')
            .replace(/conditions:\s*\w+/gi, '')
            .replace(/(❓|🔍|📝|💡|👣|✅|⚠️|🧠|📌|⏰|💬|🎯)\s*/g, '')
            .replace(/\b(Question|Note|Tip|Step|Check|Warning|Summary|Reminder|Advice|Advise):\s*/gi, '')
            .replace(/\n+/g, ' ')
            .trim();

        const sentences = cleanReply.match(/[^.!?]*[.!?]+/g) || [cleanReply];
        const uniqueSentences = [...new Set(sentences.map(s => s.trim()))];
        cleanReply = uniqueSentences.join(' ').trim();

        if (!cleanReply || cleanReply.length === 0) {
            cleanReply = "I understand. How can I help you further?";
        }

        res.status(200).json({
            success: true,
            reply: cleanReply,
            thread_id: threadId
        });

    } catch (error) {
        console.error('Voice Chat Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing voice message.',
            error: error.message
        });
    }
});

module.exports = router;