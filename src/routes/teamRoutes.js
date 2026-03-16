// src/routes/teamRoutes.js

import express from 'express';
import { createTeam, getAllTeams, deleteTeam } from '../controllers/teams.js';
import { createUser, getAllUsers, updateUser, deleteUser } from '../controllers/users.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

// Team routes
router.post('/players/teams', authenticateToken, createTeam);
router.get('/players/teams', authenticateToken, getAllTeams);
router.delete('/players/teams/:id', authenticateToken, deleteTeam);


// User management routes
router.post('/players/users', authenticateToken, createUser);
router.get('/players/users', authenticateToken, getAllUsers);
router.put('/players/users/:userId', authenticateToken, updateUser);
router.delete('/players/users/:userId', authenticateToken, deleteUser);

export default router;
