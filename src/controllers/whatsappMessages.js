// src/controllers/whatsappMessages.js

import connectDB from '../db/index.js';
import { logger } from '../logger.js';

// Get all WhatsApp messages for a user/company
export const getWhatsAppMessages = async (req, res) => {
    let conn;
    try {
        const { limit = 50, offset = 0, sender_number, receiver_number, message_type, direction } = req.query;
        const userEmail = req.user.email;

        const pool = connectDB();
        conn = await pool.getConnection();

        // Get user's company and team info
        const [userData] = await conn.query(
            'SELECT company_id, team_id FROM users WHERE email = ?',
            [userEmail]
        );

        if (!userData.length) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const { company_id, team_id } = userData[0];

        // Build query with filters
        let query = `
            SELECT * FROM whatsapp_messages 
            WHERE (company_id = ? OR team_id = ?)
        `;
        const params = [company_id, team_id];

        if (sender_number) {
            query += ' AND sender_number = ?';
            params.push(sender_number);
        }

        if (receiver_number) {
            query += ' AND receiver_number = ?';
            params.push(receiver_number);
        }

        if (message_type) {
            query += ' AND message_type = ?';
            params.push(message_type);
        }

        if (direction) {
            query += ' AND direction = ?';
            params.push(direction);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const [messages] = await conn.query(query, params);

        // Get total count
        let countQuery = `
            SELECT COUNT(*) as total FROM whatsapp_messages 
            WHERE (company_id = ? OR team_id = ?)
        `;
        const countParams = [company_id, team_id];

        if (sender_number) {
            countQuery += ' AND sender_number = ?';
            countParams.push(sender_number);
        }

        if (receiver_number) {
            countQuery += ' AND receiver_number = ?';
            countParams.push(receiver_number);
        }

        if (message_type) {
            countQuery += ' AND message_type = ?';
            countParams.push(message_type);
        }

        if (direction) {
            countQuery += ' AND direction = ?';
            countParams.push(direction);
        }

        const [countResult] = await conn.query(countQuery, countParams);
        const total = countResult[0].total;

        res.json({
            success: true,
            messages,
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: (parseInt(offset) + parseInt(limit)) < total
            }
        });

    } catch (error) {
        logger.error('Error fetching WhatsApp messages:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch messages' });
    } finally {
        if (conn) conn.release();
    }
};

// Get messages for a specific conversation
export const getConversation = async (req, res) => {
    let conn;
    try {
        const { phoneNumber } = req.params;
        const { limit = 50, offset = 0 } = req.query;
        const userEmail = req.user.email;

        const pool = connectDB();
        conn = await pool.getConnection();

        // Get user's company and team info
        const [userData] = await conn.query(
            'SELECT company_id, team_id FROM users WHERE email = ?',
            [userEmail]
        );

        if (!userData.length) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const { company_id, team_id } = userData[0];

        // Get conversation messages (both sent and received)
        const [messages] = await conn.query(
            `SELECT * FROM whatsapp_messages 
            WHERE (company_id = ? OR team_id = ?)
            AND (sender_number = ? OR receiver_number = ?)
            ORDER BY message_timestamp ASC, created_at ASC
            LIMIT ? OFFSET ?`,
            [company_id, team_id, phoneNumber, phoneNumber, parseInt(limit), parseInt(offset)]
        );

        // Get total count
        const [countResult] = await conn.query(
            `SELECT COUNT(*) as total FROM whatsapp_messages 
            WHERE (company_id = ? OR team_id = ?)
            AND (sender_number = ? OR receiver_number = ?)`,
            [company_id, team_id, phoneNumber, phoneNumber]
        );

        const total = countResult[0].total;

        res.json({
            success: true,
            messages,
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: (parseInt(offset) + parseInt(limit)) < total
            }
        });

    } catch (error) {
        logger.error('Error fetching conversation:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch conversation' });
    } finally {
        if (conn) conn.release();
    }
};

// Get message statistics
export const getMessageStats = async (req, res) => {
    let conn;
    try {
        const userEmail = req.user.email;

        const pool = connectDB();
        conn = await pool.getConnection();

        // Get user's company and team info
        const [userData] = await conn.query(
            'SELECT company_id, team_id FROM users WHERE email = ?',
            [userEmail]
        );

        if (!userData.length) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const { company_id, team_id } = userData[0];

        // Get statistics
        const [stats] = await conn.query(
            `SELECT 
                COUNT(*) as total_messages,
                SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) as incoming_messages,
                SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) as outgoing_messages,
                SUM(CASE WHEN message_type = 'text_message' THEN 1 ELSE 0 END) as text_messages,
                SUM(CASE WHEN message_type != 'text_message' THEN 1 ELSE 0 END) as media_messages,
                COUNT(DISTINCT sender_number) as unique_senders,
                COUNT(DISTINCT receiver_number) as unique_receivers
            FROM whatsapp_messages 
            WHERE (company_id = ? OR team_id = ?)`,
            [company_id, team_id]
        );

        res.json({
            success: true,
            stats: stats[0]
        });

    } catch (error) {
        logger.error('Error fetching message stats:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch stats' });
    } finally {
        if (conn) conn.release();
    }
};

// Get list of conversations (unique phone numbers)
export const getConversationList = async (req, res) => {
    let conn;
    try {
        const userEmail = req.user.email;

        const pool = connectDB();
        conn = await pool.getConnection();

        // Get user's company and team info
        const [userData] = await conn.query(
            'SELECT company_id, team_id FROM users WHERE email = ?',
            [userEmail]
        );

        if (!userData.length) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const { company_id, team_id } = userData[0];

        // Get unique conversations with latest message
        const [conversations] = await conn.query(
            `SELECT 
                CASE 
                    WHEN direction = 'incoming' THEN sender_number
                    ELSE receiver_number
                END as phone_number,
                CASE 
                    WHEN direction = 'incoming' THEN sender_name
                    ELSE receiver_name
                END as contact_name,
                MAX(message_timestamp) as last_message_time,
                MAX(created_at) as last_message_created,
                COUNT(*) as message_count,
                SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) as incoming_count,
                SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) as outgoing_count
            FROM whatsapp_messages 
            WHERE (company_id = ? OR team_id = ?)
            GROUP BY phone_number, contact_name
            ORDER BY last_message_time DESC`,
            [company_id, team_id]
        );

        res.json({
            success: true,
            conversations
        });

    } catch (error) {
        logger.error('Error fetching conversation list:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch conversations' });
    } finally {
        if (conn) conn.release();
    }
};
