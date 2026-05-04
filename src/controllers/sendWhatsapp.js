// src/controllers/sendWhatsapp.js

import connectDB from '../db/index.js';
import dotenv from 'dotenv';
import { logger } from '../logger.js';
import { instances } from './whatsapp.js';

dotenv.config();

// Helper to normalize username -> instance id (e.g. "John Doe" -> "john_doe")
const usernameToInstance = (name='') => name.toLowerCase().replace(/\s+/g, '_');

// Resolve instance id in priority: explicit param -> username from req.user -> env default
const resolveInstanceId = (explicit, req) => {
    if (explicit) return explicit;
    if (req?.user?.username) return usernameToInstance(req.user.username);
    return process.env.WHATSAPP_INSTANCE_ID || 'default_instance';
};

/**
 * Send WhatsApp notification when a new customer is added
 * @param {Object} customerData - Customer information
 * @param {string} teamPhone - Team phone number to send notification to
 * @param {string} instanceIdParam - WhatsApp instance ID
 * @returns {Promise} - Resolves when message is sent
 */
export const sendCustomerNotification = async (customerData, teamPhone, instanceIdParam) => {
    const {
        customer_name,
        phone_no_primary,
        phone_no_secondary,
        email_id,
        address,
        country,
        designation,
        QUEUE_NAME,
        disposition,
        comment,
        C_unique_id
    } = customerData;

    // Prepare display name for queue (replace underscores with spaces)
    const displayQueueName = QUEUE_NAME ? QUEUE_NAME.replace(/_/g, ' ') : 'Team';

    // Format the message content
    const messageContent = `*New Customer Query - ${customer_name || 'N/A'}*

Greetings!
We received enquiry for the below client, kindly please assist them for the below mentioned details:

Customer Information:
*Name* : ${customer_name || 'N/A'}
*Phone* : ${phone_no_primary || 'N/A'}
*Alt Phone* : ${phone_no_secondary || 'N/A'}
*Email* : ${email_id || 'N/A'}
*Address* : ${address || 'N/A'}
*Country* : ${country || 'N/A'}
*Designation* : ${designation || 'N/A'}
*Disposition* : ${disposition || 'N/A'}
*Unique ID* : ${C_unique_id || 'N/A'}
*Message* : ${comment || 'N/A'}

Thank you!
Regards`;

    try {
        const instanceId = resolveInstanceId(instanceIdParam);
        const instance = instances[instanceId];
        let sock = instance?.sock;

        // Wait up to 30 seconds for the instance to connect if it's currently connecting
        const MAX_WAIT = 30000; // ms
        const POLL = 1000; // ms
        let waited = 0;
        while ((!sock || instance.status !== 'connected') && waited < MAX_WAIT) {
            await new Promise(r => setTimeout(r, POLL));
            waited += POLL;
            sock = instance?.sock; // refresh reference in case it becomes ready
        }

        if (!sock || instance.status !== 'connected') {
            const err = new Error('WhatsApp instance not connected');
            err.code = 'WHATSAPP_NOT_CONNECTED';
            throw err;
        }

        const jid = teamPhone.replace(/\D/g, '') + '@s.whatsapp.net';

        // Retry sendMessage up to 3 times to mitigate transient timeouts
        let attempts = 0;
        const MAX_ATTEMPTS = 3;
        while (attempts < MAX_ATTEMPTS) {
            try {
                await sock.sendMessage(jid, { text: messageContent });
                break; // success
            } catch (err) {
                const isTimeout = (err.output && err.output.statusCode === 408) || err.message?.includes('Timed Out');
                if (!isTimeout) throw err; // re-throw non-timeout errors immediately
                attempts++;
                if (attempts === MAX_ATTEMPTS) {
                    err.code = 'WHATSAPP_TIMED_OUT';
                    throw err;
                }
                // exponential backoff 1s,2s
                await new Promise(r => setTimeout(r, 1000 * attempts));
            }
        }

        logger.info(`WhatsApp notification sent successfully for customer: ${customer_name}`);
    } catch (error) {
        logger.error('Error sending WhatsApp notification:', error);
        throw error;
    }
};

// Send new customer WhatsApp notification
export const sendNewCustomerWhatsApp = async (req, res) => {
    let connection;
    try {
        const { customerId, teamId, instanceId: bodyInstanceId } = req.body;

        if (!customerId || !teamId) {
            return res.status(400).json({
                success: false,
                message: 'Customer ID and Team ID are required'
            });
        }

        const pool = await connectDB();
        connection = await pool.getConnection();

        // Get team phone number
        const [teams] = await connection.query(
            'SELECT team_phone FROM teams WHERE id = ?',
            [teamId]
        );

        if (!teams || teams.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Team not found'
            });
        }

        // Get customer details
        const [customers] = await connection.query(
            'SELECT * FROM customers WHERE id = ?',
            [customerId]
        );

        if (!customers || customers.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        // Determine instance id to use
        const instanceId = resolveInstanceId(bodyInstanceId, req);

        // Send WhatsApp notification
        try {
            await sendCustomerNotification(customers[0], teams[0].team_phone, instanceId);
        } catch (err) {
            // If requested instance not connected, attempt fallback to default env instance
            if (err.code === 'WHATSAPP_NOT_CONNECTED') {
                const fallbackId = process.env.WHATSAPP_INSTANCE_ID;
                if (fallbackId && fallbackId !== instanceId) {
                    logger.warn(`Primary instance "${instanceId}" not connected, retrying with fallback "${fallbackId}"`);
                    await sendCustomerNotification(customers[0], teams[0].team_phone, fallbackId);
                } else {
                    throw err;
                }
            } else {
                throw err;
            }
        }

        res.json({
            success: true,
            message: 'WhatsApp notification sent successfully'
        });

    } catch (error) {
        logger.error('Error in sendNewCustomerWhatsApp:', error);
        
        // Check for connection refused error
        if (error.code === 'ECONNREFUSED' || (error.cause && error.cause.code === 'ECONNREFUSED')) {
            return res.status(503).json({
                success: false,
                message: 'WhatsApp service is disconnected',
                error: {
                    code: 'ECONNREFUSED',
                    message: 'Unable to connect to WhatsApp service'
                }
            });
        }

        // WhatsApp instance exists but is not connected/ready or timed out
        if (error.code === 'WHATSAPP_NOT_CONNECTED' || error.code === 'WHATSAPP_TIMED_OUT') {
            return res.status(503).json({
                success: false,
                code: 'WHATSAPP_NOT_READY',
                message: 'WhatsApp instance not ready. Please scan QR or wait until connected.'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to send WhatsApp notification',
            error: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

