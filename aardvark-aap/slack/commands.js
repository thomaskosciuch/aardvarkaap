const { EC2Client, AuthorizeSecurityGroupIngressCommand, RevokeSecurityGroupIngressCommand, DescribeSecurityGroupsCommand } = require('@aws-sdk/client-ec2');
const { slackApp } = require('../slack');
const db = require('../db');

const ec2 = new EC2Client();
const BASTION_SG_ID = process.env.BASTION_SG_ID;

/**
 * Validate an IPv4 address.
 */
function isValidIpv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(part => {
    const num = Number(part);
    return Number.isInteger(num) && num >= 0 && num <= 255 && part === String(num);
  });
}

/**
 * Get current SSH ingress rules on the bastion security group.
 */
async function getBastionIngressRules() {
  const { SecurityGroups } = await ec2.send(new DescribeSecurityGroupsCommand({
    GroupIds: [BASTION_SG_ID],
  }));

  if (!SecurityGroups || SecurityGroups.length === 0) {
    throw new Error('Bastion security group not found');
  }

  return SecurityGroups[0].IpPermissions.filter(
    rule => rule.FromPort === 22 && rule.ToPort === 22 && rule.IpProtocol === 'tcp'
  );
}

// --- /db-whitelist-ip ---
slackApp.command('/db-whitelist-ip', async ({ command, ack, respond }) => {
  await ack();

  if (!BASTION_SG_ID) {
    await respond({ text: ':x: BASTION_SG_ID is not configured. Contact an admin.' });
    return;
  }

  const ip = command.text.trim();
  if (!ip || !isValidIpv4(ip)) {
    await respond({ text: ':warning: Please provide a valid IPv4 address.\nUsage: `/db-whitelist-ip 1.2.3.4`' });
    return;
  }

  const cidr = `${ip}/32`;

  try {
    await ec2.send(new AuthorizeSecurityGroupIngressCommand({
      GroupId: BASTION_SG_ID,
      IpPermissions: [{
        IpProtocol: 'tcp',
        FromPort: 22,
        ToPort: 22,
        IpRanges: [{ CidrIp: cidr, Description: `Whitelisted by ${command.user_name} via Slack` }],
      }],
    }));

    // Record in database
    try {
      await db.query(
        'INSERT INTO ip_whitelist (ip_address, whitelisted_by, slack_user_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE whitelisted_by = VALUES(whitelisted_by), slack_user_id = VALUES(slack_user_id), whitelisted_at = CURRENT_TIMESTAMP',
        [ip, command.user_name, command.user_id]
      );
    } catch (dbError) {
      console.error('Failed to record IP whitelist in database:', dbError.message);
    }

    await respond({ text: `:white_check_mark: IP \`${cidr}\` has been whitelisted for SSH access to the bastion host.` });
  } catch (error) {
    if (error.name === 'InvalidPermission.Duplicate') {
      await respond({ text: `:information_source: IP \`${cidr}\` is already whitelisted.` });
    } else {
      console.error('Error whitelisting IP:', error);
      await respond({ text: `:x: Failed to whitelist IP: ${error.message}` });
    }
  }
});

// --- /db-remove-ip ---
slackApp.command('/db-remove-ip', async ({ command, ack, respond }) => {
  await ack();

  if (!BASTION_SG_ID) {
    await respond({ text: ':x: BASTION_SG_ID is not configured. Contact an admin.' });
    return;
  }

  const ip = command.text.trim();
  if (!ip || !isValidIpv4(ip)) {
    await respond({ text: ':warning: Please provide a valid IPv4 address.\nUsage: `/db-remove-ip 1.2.3.4`' });
    return;
  }

  const cidr = `${ip}/32`;

  try {
    await ec2.send(new RevokeSecurityGroupIngressCommand({
      GroupId: BASTION_SG_ID,
      IpPermissions: [{
        IpProtocol: 'tcp',
        FromPort: 22,
        ToPort: 22,
        IpRanges: [{ CidrIp: cidr }],
      }],
    }));

    // Remove from database
    try {
      await db.query('DELETE FROM ip_whitelist WHERE ip_address = ?', [ip]);
    } catch (dbError) {
      console.error('Failed to remove IP whitelist from database:', dbError.message);
    }

    await respond({ text: `:white_check_mark: IP \`${cidr}\` has been removed from the bastion whitelist.` });
  } catch (error) {
    console.error('Error removing IP:', error);
    await respond({ text: `:x: Failed to remove IP: ${error.message}` });
  }
});

// --- /db-list-ips ---
slackApp.command('/db-list-ips', async ({ ack, respond }) => {
  await ack();

  if (!BASTION_SG_ID) {
    await respond({ text: ':x: BASTION_SG_ID is not configured. Contact an admin.' });
    return;
  }

  try {
    // Pull from database for richer info (who whitelisted, when)
    const rows = await db.query('SELECT ip_address, whitelisted_by, whitelisted_at FROM ip_whitelist ORDER BY whitelisted_at DESC');

    if (rows.length === 0) {
      await respond({ text: ':information_source: No IPs are currently whitelisted for bastion SSH access.' });
    } else {
      const lines = rows.map(row => {
        const when = new Date(row.whitelisted_at).toLocaleDateString('en-CA');
        return `\`${row.ip_address}/32\` — whitelisted by *${row.whitelisted_by}* on ${when}`;
      });
      await respond({ text: `:lock: *Whitelisted IPs for bastion SSH access:*\n${lines.map(l => `• ${l}`).join('\n')}` });
    }
  } catch (error) {
    // Fall back to security group if DB is unavailable
    console.error('Database query failed, falling back to security group:', error.message);
    try {
      const sshRules = await getBastionIngressRules();
      const ips = sshRules.flatMap(rule =>
        (rule.IpRanges || []).map(range => {
          const desc = range.Description ? ` — _${range.Description}_` : '';
          return `\`${range.CidrIp}\`${desc}`;
        })
      );

      if (ips.length === 0) {
        await respond({ text: ':information_source: No IPs are currently whitelisted for bastion SSH access.' });
      } else {
        await respond({ text: `:lock: *Whitelisted IPs for bastion SSH access:*\n${ips.map(ip => `• ${ip}`).join('\n')}` });
      }
    } catch (sgError) {
      console.error('Error listing IPs:', sgError);
      await respond({ text: `:x: Failed to list IPs: ${sgError.message}` });
    }
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
