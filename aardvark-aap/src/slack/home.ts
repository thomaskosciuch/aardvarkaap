import type { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/types';
import * as store from '../store';
import type { WebhookMessage } from '../store';

function buildHomeBlocks(): KnownBlock[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayMessages = store.messages.filter(m => new Date(m.timestamp) >= todayStart);

  const uptimeStr = formatUptime();

  const blocks: KnownBlock[] = [
    ...todaySection(uptimeStr, todayMessages),
    { type: 'divider' },
    ...logSection(),
    { type: 'divider' },
    ...configSection(),
  ];

  return blocks;
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

function configSection(): KnownBlock[] {
  return [
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
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Slash commands:*\n`/db-listusers` — list database users\n`/db-adduser <user> <pass>` — create read-only user (admin)\n`/db-removeuser <user>` — drop user (admin)',
      },
    },
  ];
}

async function publishHome(client: WebClient, userId: string): Promise<void> {
  await client.views.publish({
    user_id: userId,
    view: {
      type: 'home',
      callback_id: 'home_view',
      blocks: buildHomeBlocks(),
    },
  });
}

export { buildHomeBlocks, publishHome };
