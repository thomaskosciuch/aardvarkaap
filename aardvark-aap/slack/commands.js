const { slackApp } = require('../slack');
const { getPool } = require('../db/connection');

const ADMIN_USERS = [
  'U01J9R9DR9N', // Matt Petras
  'U0362BDQQM6', // Thomas
];

const SYSTEM_USERS = ['rdsadmin', 'mysql.sys', 'mysql.session', 'mysql.infoschema'];

console.log('Slash commands registered: /db-adduser, /db-listusers, /db-removeuser');

function isAdmin(userId) {
  return ADMIN_USERS.includes(userId);
}

function classifyGrants(grants) {
  const joined = grants.join(' ').toUpperCase();
  if (joined.includes('ALL PRIVILEGES')) return 'admin';
  if (joined.includes('SELECT') && !joined.includes('INSERT') && !joined.includes('UPDATE')) return 'read-only';
  return 'custom';
}

// /db-adduser <username> <password>
slackApp.command('/db-adduser', async ({ ack, body, respond }) => {
  await ack();

  if (!isAdmin(body.user_id)) {
    return respond({ text: ':no_entry: Only admins can add database users.', response_type: 'ephemeral' });
  }

  const args = (body.text || '').trim().split(/\s+/);
  if (args.length < 2) {
    return respond({ text: ':warning: Usage: `/db-adduser <username> <password>`', response_type: 'ephemeral' });
  }

  const [username, password] = args;
  const pool = getPool();

  try {
    const conn = await pool.getConnection();
    try {
      await conn.execute(`CREATE USER ?@'%' IDENTIFIED BY ?`, [username, password]);
      await conn.execute(`GRANT SELECT ON aardvark.* TO ?@'%'`, [username]);
      await conn.execute('FLUSH PRIVILEGES');
    } finally {
      conn.release();
    }

    await respond({
      text: `:white_check_mark: Created user \`${username}\` with *read-only* access.`,
      response_type: 'ephemeral',
    });
  } catch (err) {
    console.error('db-adduser error:', err);
    await respond({
      text: `:x: Failed to create user: ${err.message}`,
      response_type: 'ephemeral',
    });
  }
});

slackApp.command('/db-listusers', async ({ ack, respond }) => {
  await ack();

  const pool = getPool();

  try {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute('SELECT user, host FROM mysql.user WHERE user NOT IN (?)', [SYSTEM_USERS]);

      if (rows.length === 0) {
        return respond({ text: '_No database users found._', response_type: 'ephemeral' });
      }

      const lines = [];
      for (const row of rows) {
        try {
          const [grants] = await conn.execute(`SHOW GRANTS FOR ?@?`, [row.user, row.host]);
          const grantStrings = grants.map(g => Object.values(g)[0]);
          const level = classifyGrants(grantStrings);
          lines.push(`\`${row.user}\`  —  ${level}`);
        } catch {
          lines.push(`\`${row.user}\`  —  unknown`);
        }
      }

      await respond({
        text: `:card_file_box: *Database users:*\n${lines.join('\n')}`,
        response_type: 'ephemeral',
      });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('db-listusers error:', err);
    await respond({
      text: `:x: Failed to list users: ${err.message}`,
      response_type: 'ephemeral',
    });
  }
});

// /db-removeuser <username>
slackApp.command('/db-removeuser', async ({ ack, body, respond }) => {
  await ack();

  if (!isAdmin(body.user_id)) {
    return respond({ text: ':no_entry: Only admins can remove database users.', response_type: 'ephemeral' });
  }

  const username = (body.text || '').trim().split(/\s+/)[0];
  if (!username) {
    return respond({ text: ':warning: Usage: `/db-removeuser <username>`', response_type: 'ephemeral' });
  }

  // Prevent deleting the RDS admin
  if (username === 'aardvark_admin') {
    return respond({ text: ':no_entry: Cannot remove the RDS admin user.', response_type: 'ephemeral' });
  }

  const pool = getPool();

  try {
    const conn = await pool.getConnection();
    try {
      await conn.execute(`DROP USER ?@'%'`, [username]);
    } finally {
      conn.release();
    }

    await respond({
      text: `:wastebasket: Removed user \`${username}\`.`,
      response_type: 'ephemeral',
    });
  } catch (err) {
    console.error('db-removeuser error:', err);
    await respond({
      text: `:x: Failed to remove user: ${err.message}`,
      response_type: 'ephemeral',
    });
  }
});
