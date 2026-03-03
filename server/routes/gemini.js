import express from 'express';
import sessionManager from '../sessionManager.js';

const router = express.Router();

router.get('/sessions/:sessionId/messages', async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!sessionId || typeof sessionId !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(sessionId)) {
            return res.status(400).json({ success: false, error: 'Invalid session ID format' });
        }

        const messages = sessionManager.getSessionMessages(sessionId);
        const total = messages.length;

        res.json({
            success: true,
            messages: messages,
            total,
            offsetBegin: total > 0 ? 0 : -1,
            offsetEnd: total > 0 ? total - 1 : -1,
        });
    } catch (error) {
        console.error('Error fetching Gemini session messages:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!sessionId || typeof sessionId !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(sessionId)) {
            return res.status(400).json({ success: false, error: 'Invalid session ID format' });
        }

        await sessionManager.deleteSession(sessionId);
        res.json({ success: true });
    } catch (error) {
        console.error(`Error deleting Gemini session ${req.params.sessionId}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
