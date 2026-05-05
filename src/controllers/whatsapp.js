// src/controllers/whatsapp.js

import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode';
import { 
    makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState, 
    Browsers, 
    downloadMediaMessage,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    isJidBroadcast
} from '@whiskeysockets/baileys';
import { logger } from '../logger.js';
import connectDB from '../db/index.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import NodeCache from '@cacheable/node-cache';
import P from 'pino';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create Baileys logger
const baileysLogger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` });
baileysLogger.level = 'silent'; // Set to 'trace' for debugging

// External map to store retry counts of messages when decryption/encryption fails
const msgRetryCounterCache = new NodeCache();

// Store active instances
export const instances = {};

// Handle incoming WhatsApp messages
const handleIncomingMessage = async (message, instanceId, registerId, sock) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        // Extract message details
        const messageId = message.key.id;
        const remoteJid = message.key.remoteJid;
        const participant = message.key.participant; // The actual sender in groups
        const senderPn = message.key.senderPn; // The actual sender in channels (NEW!)
        
        // Filter out broadcasts and status
        const isBroadcast = remoteJid.includes('broadcast');
        const isStatus = remoteJid === 'status@broadcast';
        
        // Skip broadcasts and status updates
        if (isBroadcast || isStatus) {
            logger.info(`Skipping message from ${remoteJid} (broadcast/status)`);
            return;
        }
        
        // Determine the actual sender
        let senderJid;
        const isGroup = remoteJid.endsWith('@g.us');
        const isChannel = remoteJid.includes('@lid') || remoteJid.includes('@newsletter');
        
        if (isChannel && senderPn) {
            // Channel message - use senderPn field
            senderJid = senderPn;
            logger.info(`Channel message from senderPn: ${senderPn}`);
        } else if (isGroup && participant) {
            // Group message - use participant field
            senderJid = participant;
            logger.info(`Group message from participant: ${participant}`);
        } else if (!isGroup && !isChannel) {
            // Direct message - use remoteJid
            senderJid = remoteJid;
        } else {
            // Channel/group message without sender info - skip it
            logger.info(`Skipping ${isChannel ? 'channel' : 'group'} message without sender info: ${remoteJid}`);
            return;
        }
        
        // Extract clean phone number (remove @s.whatsapp.net or @lid suffix)
        const senderNumber = senderJid.split('@')[0];
        const senderName = message.pushName || 'Unknown';
        const messageTimestamp = message.messageTimestamp;
        
        logger.info(`Processing message from ${senderNumber} (${senderName}), remoteJid: ${remoteJid}`);

        // Get instance details
        const [instanceData] = await conn.query(
            'SELECT i.*, u.company_id, u.team_id, c.company_name, t.team_name FROM instances i LEFT JOIN users u ON i.register_id = u.email LEFT JOIN companies c ON u.company_id = c.id LEFT JOIN teams t ON u.team_id = t.id WHERE i.instance_id = ?',
            [instanceId]
        );

        const companyId = instanceData[0]?.company_id || null;
        const companyName = instanceData[0]?.company_name || null;
        const teamId = instanceData[0]?.team_id || null;
        const teamName = instanceData[0]?.team_name || null;
        const receiverNumber = registerId;

        let messageType = 'text_message';
        let messageContent = '';
        let mediaUrl = null;
        let mediaFilename = null;
        let mediaMimetype = null;

        // Determine message type and extract content
        if (message.message?.conversation) {
            messageType = 'text_message';
            messageContent = message.message.conversation;
        } else if (message.message?.extendedTextMessage) {
            messageType = 'text_message';
            messageContent = message.message.extendedTextMessage.text;
        } else if (message.message?.imageMessage) {
            messageType = 'image';
            messageContent = message.message.imageMessage.caption || '';
            mediaMimetype = message.message.imageMessage.mimetype;
            
            // Download media
            const buffer = await downloadMediaMessage(message, 'buffer', {});
            const filename = `whatsapp_${Date.now()}_${messageId}.${mediaMimetype.split('/')[1]}`;
            const uploadDir = path.join(__dirname, '../../public/uploads/whatsapp');
            
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            
            const filepath = path.join(uploadDir, filename);
            fs.writeFileSync(filepath, buffer);
            
            mediaUrl = `/uploads/whatsapp/${filename}`;
            mediaFilename = filename;
        } else if (message.message?.videoMessage) {
            messageType = 'video';
            messageContent = message.message.videoMessage.caption || '';
            mediaMimetype = message.message.videoMessage.mimetype;
            
            const buffer = await downloadMediaMessage(message, 'buffer', {});
            const filename = `whatsapp_${Date.now()}_${messageId}.${mediaMimetype.split('/')[1]}`;
            const uploadDir = path.join(__dirname, '../../public/uploads/whatsapp');
            
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            
            const filepath = path.join(uploadDir, filename);
            fs.writeFileSync(filepath, buffer);
            
            mediaUrl = `/uploads/whatsapp/${filename}`;
            mediaFilename = filename;
        } else if (message.message?.documentMessage) {
            messageType = 'document';
            messageContent = message.message.documentMessage.caption || '';
            mediaMimetype = message.message.documentMessage.mimetype;
            mediaFilename = message.message.documentMessage.fileName;
            
            const buffer = await downloadMediaMessage(message, 'buffer', {});
            const filename = `whatsapp_${Date.now()}_${messageId}_${mediaFilename}`;
            const uploadDir = path.join(__dirname, '../../public/uploads/whatsapp');
            
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            
            const filepath = path.join(uploadDir, filename);
            fs.writeFileSync(filepath, buffer);
            
            mediaUrl = `/uploads/whatsapp/${filename}`;
        } else if (message.message?.audioMessage) {
            messageType = 'audio';
            mediaMimetype = message.message.audioMessage.mimetype;
            
            const buffer = await downloadMediaMessage(message, 'buffer', {});
            const filename = `whatsapp_${Date.now()}_${messageId}.${mediaMimetype.split('/')[1]}`;
            const uploadDir = path.join(__dirname, '../../public/uploads/whatsapp');
            
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            
            const filepath = path.join(uploadDir, filename);
            fs.writeFileSync(filepath, buffer);
            
            mediaUrl = `/uploads/whatsapp/${filename}`;
            mediaFilename = filename;
        }

        // Save to database
        await conn.query(
            `INSERT INTO whatsapp_messages 
            (message_id, instance_id, sender_number, sender_name, receiver_number, receiver_name, 
            message_type, message_content, media_url, media_filename, media_mimetype, 
            company_id, company_name, team_id, team_name, direction, message_timestamp) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'incoming', ?)`,
            [
                messageId, instanceId, senderNumber, senderName, receiverNumber, receiverNumber,
                messageType, messageContent, mediaUrl, mediaFilename, mediaMimetype,
                companyId, companyName, teamId, teamName, messageTimestamp
            ]
        );

        logger.info(`Saved incoming message from ${senderNumber} to database`);

    } catch (error) {
        logger.error('Error handling incoming message:', error);
    } finally {
        if (conn) conn.release();
    }
};

// Initialize WhatsApp connection
export const initializeSock = async (instanceId, registerId) => {
    let conn;
    try {
        logger.info(`Initializing WhatsApp connection for instance ${instanceId}`);
        
        // keep auth outside src & back folders so nodemon doesn't watch it
        const userDir = path.resolve('..', 'auth_info');
        const authFolder = path.join(userDir, `instance_${instanceId}`);

        if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
        if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        
        // Fetch latest version of WA Web
        const { version, isLatest } = await fetchLatestBaileysVersion();
        logger.info(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

        const sock = makeWASocket({
            version,
            logger: baileysLogger,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
            },
            msgRetryCounterCache,
            generateHighQualityLinkPreview: true,
            printQRInTerminal: false,
            shouldIgnoreJid: jid => isJidBroadcast(jid),
            // Browser configuration
            browser: Browsers.macOS('Desktop')
        });

        const connectionPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 120000);

            let hasResolved = false;

            // Use sock.ev.process() - the correct Baileys v6+ API
            sock.ev.process(
                async(events) => {
                    // Handle connection updates
                    if(events['connection.update']) {
                        const update = events['connection.update'];
                        const { connection, qr, lastDisconnect } = update;
                        
                        logger.info('Connection update:', update);

                        if (qr && !hasResolved) {
                            logger.info(`Generating QR code for instance ${instanceId}`);
                            try {
                                const url = await qrcode.toDataURL(qr);
                                logger.debug('QR Code URL generated successfully');
                                
                                instances[instanceId] = {
                                    sock,
                                    qrCode: url,
                                    status: 'disconnected',
                                    lastUpdate: new Date(),
                                    registerId
                                };
                                
                                if (!hasResolved) {
                                    resolve({ qrCode: url });
                                    hasResolved = true;
                                    clearTimeout(timeout);
                                }
                            } catch (err) {
                                logger.error('Error generating QR code URL:', err);
                                if (!hasResolved) {
                                    reject(err);
                                    hasResolved = true;
                                }
                            }
                        }

                        if(connection === 'close') {
                            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                            
                            if (shouldReconnect) {
                                logger.info(`Attempting to reconnect instance ${instanceId}`);
                                instances[instanceId] = {
                                    status: 'reconnecting',
                                    lastUpdate: new Date()
                                };
                                
                                try {
                                    const pool = connectDB();
                                    conn = await pool.getConnection();
                                    await conn.query('UPDATE instances SET status = ? WHERE instance_id = ?', ['reconnecting', instanceId]);
                                } catch(dbError) {
                                    logger.error("DB update failed in 'close' (reconnect) state", dbError);
                                } finally {
                                    if (conn) conn.release();
                                }

                                setTimeout(async () => {
                                    try {
                                        await initializeSock(instanceId, registerId);
                                    } catch (reconnectError) {
                                        logger.error(`Reconnection failed for instance ${instanceId}:`, reconnectError);
                                    }
                                }, 5000);
                            } else {
                                logger.info(`Connection closed. User logged out for instance ${instanceId}`);
                                instances[instanceId] = {
                                    status: 'logged_out',
                                    lastUpdate: new Date()
                                };
                                
                                try {
                                    const pool = connectDB();
                                    conn = await pool.getConnection();
                                    await conn.query('UPDATE instances SET status = ? WHERE instance_id = ?', ['disconnected', instanceId]);
                                } catch(dbError) {
                                    logger.error("DB update failed in 'close' (no-reconnect) state", dbError);
                                } finally {
                                    if (conn) conn.release();
                                }
                                
                                if (!hasResolved) {
                                    reject(new Error('User logged out. Please generate a new QR code.'));
                                    hasResolved = true;
                                }
                            }
                        }

                        if (connection === 'open') {
                            logger.info(`Connection opened for instance ${instanceId}`);
                            clearTimeout(timeout);
                            
                            instances[instanceId] = {
                                sock,
                                status: 'connected',
                                lastUpdate: new Date(),
                                registerId
                            };

                            try {
                                const pool = connectDB();
                                conn = await pool.getConnection();
                                await conn.query('UPDATE instances SET status = ? WHERE instance_id = ?', ['connected', instanceId]);
                            } catch(dbError) {
                                logger.error("DB update failed in 'open' state", dbError);
                            } finally {
                                if (conn) conn.release();
                            }

                            if (!hasResolved) {
                                resolve({ connected: true });
                                hasResolved = true;
                            }
                        }
                    }

                    // Handle credentials update
                    if(events['creds.update']) {
                        await saveCreds();
                    }

                    // Handle incoming messages
                    if (events['messages.upsert']) {
                        const upsert = events['messages.upsert'];
                        logger.info('Received messages:', JSON.stringify(upsert, undefined, 2));

                        if (upsert.type === 'notify') {
                            for (const msg of upsert.messages) {
                                if (!msg.key.fromMe) {
                                    // Log the complete message key structure
                                    logger.info('Message key details:', {
                                        remoteJid: msg.key.remoteJid,
                                        participant: msg.key.participant,
                                        fromMe: msg.key.fromMe,
                                        id: msg.key.id,
                                        pushName: msg.pushName
                                    });
                                    
                                    try {
                                        await handleIncomingMessage(msg, instanceId, registerId, sock);
                                    } catch (error) {
                                        logger.error('Error storing incoming message:', error);
                                    }
                                }
                            }
                        }
                    }

                    // Handle message updates
                    if(events['messages.update']) {
                        logger.info('Messages updated:', JSON.stringify(events['messages.update'], undefined, 2));
                    }

                    if(events['message-receipt.update']) {
                        logger.info('Message receipt update:', events['message-receipt.update']);
                    }
                }
            );
        });

        return connectionPromise;
    } catch (error) {
        logger.error('Error in initializeSock:', error);
        throw error;
    }
};

export const generateQRCode = async (req, res) => {
    let conn;
    try {
        const { instanceId } = req.params;
        const registerId = req.user.email;

        const pool = connectDB();
        conn = await pool.getConnection();
        const [instance] = await conn.query('SELECT * FROM instances WHERE instance_id = ? AND register_id = ?', [instanceId, registerId]);

        if (!instance.length) {
            return res.status(404).json({ success: false, message: 'Instance not found or unauthorized' });
        }

        const existingInstance = instances[instanceId];
        if (existingInstance?.status === 'connected') {
            return res.json({ success: true, isAuthenticated: true });
        }

        if (existingInstance?.sock) {
            await existingInstance.sock.logout().catch(() => {});
        }

        const result = await initializeSock(instanceId, registerId);
        res.json({ success: true, ...result });

    } catch (error) {
        logger.error('QR code generation error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate QR code' });
    } finally {
        if (conn) conn.release();
    }
};

export const getConnectionStatus = async (req, res) => {
    let conn;
    try {
        const { instanceId } = req.params;
        const registerId = req.user.email;

        const pool = connectDB();
        conn = await pool.getConnection();
        const [instance] = await conn.query('SELECT * FROM instances WHERE instance_id = ? AND register_id = ?', [instanceId, registerId]);

        if (!instance.length) {
            // Check if user already has any instance
            const [existingUserInstance] = await conn.query('SELECT * FROM instances WHERE register_id = ?', [registerId]);
            
            if (existingUserInstance.length > 0) {
                // User already has an instance, return that instead of creating a new one
                const existingInstanceId = existingUserInstance[0].instance_id;
                logger.info(`User ${registerId} already has instance ${existingInstanceId}, returning existing instance`);
                
                const instanceData = instances[existingInstanceId];
                const dbStatus = existingUserInstance[0].status;
                
                return res.json({
                    success: true,
                    status: instanceData?.status || dbStatus,
                    message: `WhatsApp is ${instanceData?.status || dbStatus} (using existing instance)`,
                    instanceId: existingInstanceId,
                    qrCode: instanceData?.qrCode,
                    lastUpdate: instanceData?.lastUpdate
                });
            }
            
            // Auto-create a new instance entry for this user so that the first status call succeeds
            const [userRows] = await conn.query('SELECT email FROM users WHERE email = ?', [registerId]);
            if (userRows.length) {
                // Check if this instance_id already exists in the table (for any user)
                const [existingInstance] = await conn.query('SELECT instance_id FROM instances WHERE instance_id = ?', [instanceId]);
                
                let finalInstanceId = instanceId;
                
                if (existingInstance.length > 0) {
                    // Need to create a unique instance_id with suffix
                    const baseInstanceId = instanceId;
                    let counter = 1;
                    let isUnique = false;
                    
                    while (!isUnique) {
                        finalInstanceId = `${baseInstanceId}_${counter}`;
                        // Check if this new instance_id already exists
                        const [checkInstance] = await conn.query('SELECT instance_id FROM instances WHERE instance_id = ?', [finalInstanceId]);
                        if (checkInstance.length === 0) {
                            isUnique = true;
                        } else {
                            counter++;
                        }
                    }
                    
                    logger.info(`Created unique instance ID: ${finalInstanceId} for user ${registerId}`);
                }
                
                try {
                    await conn.query(
                        'INSERT INTO instances (instance_id, register_id, status) VALUES (?, ?, ?)',
                        [finalInstanceId, registerId, 'disconnected']
                    );
                    
                    return res.json({
                        success: true,
                        status: 'disconnected',
                        message: 'Instance created, waiting for initialization',
                        instanceId: finalInstanceId, // Return the potentially modified instance ID
                        qrCode: null,
                        lastUpdate: null
                    });
                } catch (insertError) {
                    // If we still get a duplicate error, try one more time with a timestamp suffix
                    if (insertError.code === 'ER_DUP_ENTRY') {
                        const timestamp = Date.now();
                        finalInstanceId = `${instanceId}_${timestamp}`;
                        logger.info(`Retry with timestamp-based instance ID: ${finalInstanceId} for user ${registerId}`);
                        
                        await conn.query(
                            'INSERT INTO instances (instance_id, register_id, status) VALUES (?, ?, ?)',
                            [finalInstanceId, registerId, 'disconnected']
                        );
                        
                        return res.json({
                            success: true,
                            status: 'disconnected',
                            message: 'Instance created with timestamp suffix, waiting for initialization',
                            instanceId: finalInstanceId,
                            qrCode: null,
                            lastUpdate: null
                        });
                    } else {
                        // Re-throw other errors
                        throw insertError;
                    }
                }
            } else {
                // Cannot create due to FK, just respond with placeholder status
                return res.json({
                    success: true,
                    status: 'disconnected',
                    message: 'No instance record yet (user not in users table)',
                    qrCode: null,
                    lastUpdate: null
                });
            }
        }

        const instanceData = instances[instanceId];
        const dbStatus = instance[0].status;

        res.json({
            success: true,
            status: instanceData?.status || dbStatus,
            message: `WhatsApp is ${instanceData?.status || dbStatus}`,
            qrCode: instanceData?.qrCode,
            lastUpdate: instanceData?.lastUpdate
        });
    } catch (error) {
        logger.error('Status check error:', error);
        res.status(500).json({ success: false, message: 'Failed to check connection status' });
    } finally {
        if (conn) conn.release();
    }
};

export const resetInstance = async (req, res) => {
    let conn;
    try {
        const { instanceId } = req.params;
        const registerId = req.user.email;

        const pool = connectDB();
        conn = await pool.getConnection();
        const [instance] = await conn.query('SELECT * FROM instances WHERE instance_id = ? AND register_id = ?', [instanceId, registerId]);

        if (!instance.length) {
            return res.status(404).json({ success: false, message: 'Instance not found or unauthorized' });
        }

        if (instances[instanceId]?.sock) {
            await instances[instanceId].sock.logout().catch(() => {});
        }
        delete instances[instanceId];

        const authFolder = path.join(path.resolve('..', 'auth_info'), `instance_${instanceId}`);
        if (fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
        }

        await conn.query('UPDATE instances SET status = ? WHERE instance_id = ?', ['disconnected', instanceId]);

        res.json({ success: true, message: 'Instance reset successfully' });
    } catch (error) {
        logger.error('Reset error:', error);
        res.status(500).json({ success: false, message: 'Failed to reset instance' });
    } finally {
        if (conn) conn.release();
    }
};

export const saveInstanceToDB = async (req, res) => {
    let conn;
    try {
        const { register_id } = req.body;
        const pool = connectDB();
        conn = await pool.getConnection();

        const [user] = await conn.query('SELECT * FROM users WHERE email = ?', [register_id]);
        if (!user.length) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const [existingInstance] = await conn.query('SELECT * FROM instances WHERE register_id = ?', [register_id]);
        if (existingInstance.length > 0) {
            return res.status(400).json({ success: false, message: 'Instance already exists for this user' });
        }

        const [result] = await conn.query('INSERT INTO instances (register_id, status) VALUES (?, ?)', [register_id, 'disconnected']);
        const [newInstance] = await conn.query('SELECT i.*, u.username as user_name FROM instances i JOIN users u ON i.register_id = u.email WHERE i.id = ?', [result.insertId]);

        res.json({ success: true, message: 'Instance created successfully', instance: newInstance[0] });
    } catch (error) {
        logger.error('Error creating instance:', error);
        res.status(500).json({ success: false, message: 'Failed to create instance' });
    } finally {
        if (conn) conn.release();
    }
};

export const getUserInstances = async (req, res) => {
    let conn;
    try {
        const { register_id } = req.params;
        const pool = connectDB();
        conn = await pool.getConnection();

        const [userInstances] = await conn.query('SELECT i.*, u.username FROM instances i JOIN users u ON i.register_id = u.email WHERE i.register_id = ?', [register_id]);

        res.json({ success: true, instances: userInstances });
    } catch (error) {
        logger.error('Error fetching instances:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch instances' });
    } finally {
        if (conn) conn.release();
    }
};

export const updateInstance = async (req, res) => {
    let conn;
    try {
        const { instance_id } = req.params;
        const { status } = req.body;
        const pool = connectDB();
        conn = await pool.getConnection();

        await conn.query('UPDATE instances SET status = ?, updated_at = NOW() WHERE instance_id = ?', [status, instance_id]);

        res.json({ success: true, message: 'Instance updated successfully' });
    } catch (error) {
        logger.error('Error updating instance:', error);
        res.status(500).json({ success: false, message: 'Failed to update instance' });
    } finally {
        if (conn) conn.release();
    }
};

export const sendMessage = async (req, res) => {
    let conn;
    try {
        const { instanceId } = req.params;
        const { messages } = req.body;
        const registerId = req.user.email;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ success: false, message: 'Messages array is required' });
        }

        const instance = instances[instanceId];
        const sock = instance?.sock;
        if (!sock || instance.status !== 'connected') {
            return res.status(400).json({ success: false, message: 'WhatsApp instance not connected' });
        }

        const pool = connectDB();
        conn = await pool.getConnection();

        // Get instance details for company/team info
        const [instanceData] = await conn.query(
            'SELECT i.*, u.company_id, u.team_id, c.company_name, t.team_name FROM instances i LEFT JOIN users u ON i.register_id = u.email LEFT JOIN companies c ON u.company_id = c.id LEFT JOIN teams t ON u.team_id = t.id WHERE i.instance_id = ?',
            [instanceId]
        );

        const companyId = instanceData[0]?.company_id || null;
        const companyName = instanceData[0]?.company_name || null;
        const teamId = instanceData[0]?.team_id || null;
        const teamName = instanceData[0]?.team_name || null;

        for (const msg of messages) {
            if (!msg.number || !msg.text) continue;
            
            // Clean phone number and create JID
            const cleanNumber = msg.number.replace(/\D/g, '');
            const jid = cleanNumber + '@s.whatsapp.net';
            
            // Send the message
            const sentMsg = await sock.sendMessage(jid, { text: msg.text });
            
            // Save to database
            const messageId = sentMsg.key.id;
            const messageTimestamp = Math.floor(Date.now() / 1000);
            
            await conn.query(
                `INSERT INTO whatsapp_messages 
                (message_id, instance_id, sender_number, sender_name, receiver_number, receiver_name, 
                message_type, message_content, media_url, media_filename, media_mimetype, 
                company_id, company_name, team_id, team_name, direction, message_timestamp) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'outgoing', ?)`,
                [
                    messageId, instanceId, registerId, registerId, cleanNumber, cleanNumber,
                    'text_message', msg.text, null, null, null,
                    companyId, companyName, teamId, teamName, messageTimestamp
                ]
            );
            
            logger.info(`Sent and saved message to ${cleanNumber}`);
        }

        return res.json({ success: true, message: 'Messages sent successfully' });
    } catch (error) {
        logger.error('Error sending WhatsApp message:', error);
        return res.status(500).json({ success: false, message: 'Failed to send message', error: error.message });
    } finally {
        if (conn) conn.release();
    }
};
