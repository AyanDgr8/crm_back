// src/routes/users.js

import express from 'express';
import { getAllUsers, getTeamMembers } from '../controllers/users.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all users (filtered based on role)
router.get('/all', authenticateToken, getAllUsers);

// Get team members for a specific team
router.get('/team/:teamId', authenticateToken, getTeamMembers);

// Get all team users (for admin roles)
router.get('/team-users', authenticateToken, getAllUsers);

export default router;
