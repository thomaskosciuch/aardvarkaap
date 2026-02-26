import express, { Router } from 'express';
import * as dbUsers from '../../db/users';

const router = Router();

// DELETE /db/users/:username
router.delete('/db/users/:username', async (req, res) => {
  const { username } = req.params;

  if (username === 'aardvark_admin') {
    res.status(403).json({ error: 'Cannot remove the RDS admin user' });
    return;
  }

  try {
    await dbUsers.removeUser(username);
    res.json({ success: true, message: `User '${username}' removed` });
  } catch (err: unknown) {
    console.error('db remove-user error:', err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// PUT /db/users/:username/password
router.put('/db/users/:username/password', express.json(), async (req, res) => {
  const { username } = req.params;
  const { password } = req.body;

  if (!password) {
    res.status(400).json({ error: 'password is required in the request body' });
    return;
  }

  if (username === 'aardvark_admin') {
    res.status(403).json({ error: 'Cannot change the RDS admin password via this endpoint' });
    return;
  }

  try {
    await dbUsers.changePassword(username, password);
    res.json({ success: true, message: `Password updated for user '${username}'` });
  } catch (err: unknown) {
    console.error('db change-password error:', err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
