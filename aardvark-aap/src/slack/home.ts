import type { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/types';
import * as store from '../store';
import * as dbAdmins from '../db/admins';
import type { WebhookMessage } from '../store';
import type { Admin } from '../db/admins';

export type HomeTab = 'dashboard' | 'admins';

interface AdminInfo {
  isAdmin: boolean;
  isSuperAdmin: boolean;
  admins: Admin[];
}

function buildHomeBlocks(tab: HomeTab, adminInfo?: AdminInfo): KnownBlock[] {
  const blocks: KnownBlock[] = [
    ...navBar(tab, adminInfo?.isAdmin ?? false),
  ];

  if (tab === 'admins' && adminInfo?.isAdmin) {
    blocks.push(...adminsPage(adminInfo.admins, adminInfo.isSuperAdmin));
  } else {
    blocks.push(...dashboardPage(adminInfo));
  }

  return blocks;
}

// --- Nav bar ---

function navBar(activeTab: HomeTab, isAdmin: boolean): KnownBlock[] {
  const buttons: object[] = [
    {
      type: 'button',
      text: { type: 'plain_text', text: ':house:  Dashboard', emoji: true },
      action_id: 'nav_dashboard',
      ...(activeTab === 'dashboard' ? { style: 'primary' } : {}),
    },
  ];

  if (isAdmin) {
    buttons.push({
      type: 'button',
      text: { type: 'plain_text', text: ':lock:  Admins', emoji: true },
      action_id: 'nav_admins',
      ...(activeTab === 'admins' ? { style: 'primary' } : {}),
    });
  }

  return [
    { type: 'actions', elements: buttons } as KnownBlock,
    { type: 'divider' },
  ];
}

// --- Dashboard tab ---

function dashboardPage(adminInfo?: AdminInfo): KnownBlock[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayMessages = store.messages.filter(m => new Date(m.timestamp) >= todayStart);

  const uptimeStr = formatUptime();

  return [
    ...todaySection(uptimeStr, todayMessages),
    { type: 'divider' },
    ...logSection(),
    { type: 'divider' },
    ...configSection(adminInfo?.isAdmin ?? false),
  ];
}

function formatUptime(): string {
  const secs = Math.floor((Date.now() - store.startTime) / 1000);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function todaySection(uptimeStr: string, todayMessages: WebhookMessage[]): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Today' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `:large_green_circle: *Running* for ${uptimeStr}` },
        { type: 'mrkdwn', text: `*Messages today:* ${todayMessages.length}` },
      ],
    },
  ];

  // Sources breakdown
  const sourceCounts: Record<string, number> = {};
  for (const msg of todayMessages) {
    sourceCounts[msg.source] = (sourceCounts[msg.source] || 0) + 1;
  }
  const entries = Object.entries(sourceCounts);
  if (entries.length > 0) {
    const text = entries
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => `${source}: ${count}`)
      .join('  |  ');
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text }],
    });
  }

  return blocks;
}

function logSection(): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Log' },
    },
  ];

  if (store.messages.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No messages yet._' },
    });
    return blocks;
  }

  const recent = store.getRecent(5);
  for (const msg of recent) {
    const ts = Math.floor(new Date(msg.timestamp).getTime() / 1000);
    blocks.push(
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${msg.source}*\n${msg.message}` },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `<!date^${ts}^{date_short_pretty} at {time}|${msg.timestamp}>` },
        ],
      }
    );
  }

  if (store.messages.length > 5) {
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `_${store.messages.length - 5} older messages not shown_` },
      ],
    });
  }

  return blocks;
}

function configSection(isAdmin: boolean): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Config' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: '*Webhook endpoint:*\n`POST /webhook`' },
        { type: 'mrkdwn', text: '*Default channel:*\n<#C09DH2G0K0Q>' },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Payload format:*\n```{\n  "message": "Build passed",\n  "source": "ci-pipeline",\n  "channel": "#deployments"\n}```',
      },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '`channel` is optional — omit it to log without posting to a channel' },
      ],
    },
  ];

  if (isAdmin) {
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Slash commands:*\n'
            + '`/db-listusers` — list database users\n'
            + '`/db-adduser <user> <pass>` — create read-only user (admin)\n'
            + '`/db-removeuser <user>` — drop user (super-admin)\n'
            + '`/db-addadmin @user` — add admin (admin)\n'
            + '`/db-removeadmin @user` — remove admin (admin)',
        },
      },
    );
  }

  return blocks;
}

// --- Admins tab ---

function adminsPage(admins: Admin[], viewerIsSuperAdmin: boolean): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Admins' },
    },
  ];

  if (admins.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No admins configured._' },
    });
    return blocks;
  }

  for (const admin of admins) {
    const role = admin.isSuperAdmin ? ':star: *super-admin*' : 'admin';
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `<@${admin.slackUserId}>  —  ${role}` },
    });
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '`/db-addadmin @user` — add admin  |  `/db-removeadmin @user` — remove admin'
            + (viewerIsSuperAdmin ? '' : '\n_Super-admins cannot be removed by regular admins._'),
        },
      ],
    },
  );

  return blocks;
}

// --- Publish ---

async function publishHome(client: WebClient, userId: string, tab: HomeTab = 'dashboard'): Promise<void> {
  let adminInfo: AdminInfo | undefined;

  try {
    const userIsAdmin = await dbAdmins.isAdmin(userId);
    if (userIsAdmin) {
      const [userIsSuperAdmin, admins] = await Promise.all([
        dbAdmins.isSuperAdmin(userId),
        dbAdmins.listAdmins(),
      ]);
      adminInfo = { isAdmin: true, isSuperAdmin: userIsSuperAdmin, admins };
    }
  } catch (err) {
    console.error('Error fetching admin info for home view:', err);
  }

  // Non-admins can't view the admins tab — fall back to dashboard
  const resolvedTab = adminInfo?.isAdmin ? tab : 'dashboard';

  await client.views.publish({
    user_id: userId,
    view: {
      type: 'home',
      callback_id: 'home_view',
      blocks: buildHomeBlocks(resolvedTab, adminInfo),
    },
  });
}

export { buildHomeBlocks, publishHome };
