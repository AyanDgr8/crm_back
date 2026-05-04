// src/controllers/whatsapp.js

import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode';
import { makeWASocket, DisconnectReason, useMultiFileAuthState, Browsers } from '@whiskeysockets/baileys';
import { logger } from '../logger.js';
import connectDB from '../db/index.js';

// Store active instances
export const instances = {};

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

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            // emulate desktop client to get richer history & avoid WA web quirks
            browser: Browsers.macOS('Desktop'),
            connectTimeoutMs: 120000,
            defaultQueryTimeoutMs: 90000,
            keepAliveIntervalMs: 15000,
            emitOwnEvents: true,
            markOnlineOnConnect: true,
            retryRequestDelayMs: 500
        });

        sock.ev.on('creds.update', saveCreds);

        const connectionPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 120000);

            let hasResolved = false;

            sock.ev.on('connection.update', async (update) => {
                const { connection, qr, lastDisconnect } = update;
                
                if (qr && !hasResolved) {
                    try {
                        const url = await qrcode.toDataURL(qr);
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
                        }
                    } catch (err) {
                        logger.error('Error generating QR code:', err);
                        reject(err);
                    }
                }

                if (connection === 'open') {
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

                    await saveCreds();

                    if (!hasResolved) {
                        resolve({ connected: true });
                        hasResolved = true;
                    }
                }

                if (connection === 'close') {
                    const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                    
                    if (shouldReconnect) {
                        if(instances[instanceId]) {
                            instances[instanceId].status = 'reconnecting';
                            instances[instanceId].lastUpdate = new Date();
                        }
                        
                        try {
                            const pool = connectDB();
                            conn = await pool.getConnection();
                            await conn.query('UPDATE instances SET status = ? WHERE instance_id = ?', ['reconnecting', instanceId]);
                        } catch(dbError) {
                            logger.error("DB update failed in 'close' (reconnect) state", dbError);
                        } finally {
                            if (conn) conn.release();
                        }

                        setTimeout(() => initializeSock(instanceId, registerId).catch(logger.error), 5000);
                    } else {
                        if(instances[instanceId]) {
                            instances[instanceId].status = 'disconnected';
                            instances[instanceId].lastUpdate = new Date();
                        }

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
                            reject(new Error('Connection closed'));
                        }
                    }
                }
            });
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
    try {
        const { instanceId } = req.params;
        const { messages } = req.body;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ success: false, message: 'Messages array is required' });
        }

        const instance = instances[instanceId];
        const sock = instance?.sock;
        if (!sock || instance.status !== 'connected') {
            return res.status(400).json({ success: false, message: 'WhatsApp instance not connected' });
        }

        for (const msg of messages) {
            if (!msg.number || !msg.text) continue;
            const jid = msg.number.replace(/\D/g, '') + '@s.whatsapp.net';
            await sock.sendMessage(jid, { text: msg.text });
        }

        return res.json({ success: true, message: 'Messages sent successfully' });
    } catch (error) {
        logger.error('Error sending WhatsApp message:', error);
        return res.status(500).json({ success: false, message: 'Failed to send message', error: error.message });
    }
};
