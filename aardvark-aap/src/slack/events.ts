import { slackApp } from '../slack';
import { publishHome, buildAddProcessModal, buildEditProcessModal } from './home';
import * as jobsDb from '../db/jobs';
import * as activityLog from '../db/activity-log';
import type { Severity, UpdateJobInput } from '../db/jobs';

slackApp.event('app_home_opened', async ({ event, client }) => {
  try {
    await publishHome(client, event.user);
  } catch (error) {
    console.error('Error publishing home view:', error);
  }
});

// Nav bar actions
slackApp.action('nav_dashboard', async ({ ack, body, client }) => {
  await ack();
  await publishHome(client, body.user.id, 'dashboard');
});

slackApp.action('nav_admins', async ({ ack, body, client }) => {
  await ack();
  await publishHome(client, body.user.id, 'admins');
});

slackApp.action('nav_processes', async ({ ack, body, client }) => {
  await ack();
  await publishHome(client, body.user.id, 'processes');
});

// Delete a process
slackApp.action('delete_process', async ({ ack, body, client, action }) => {
  await ack();
  const jobName = (action as { value?: string }).value;
  if (!jobName) return;

  try {
    await jobsDb.deleteJob(jobName);
    await activityLog.logActivity({
      jobName,
      eventType: 'job_deleted',
      actor: body.user.id,
      detail: `Deleted via Slack`,
    });
    await publishHome(client, body.user.id, 'processes');
  } catch (err) {
    console.error('Error deleting process:', err);
  }
});

// Open the Edit Process modal
slackApp.action('edit_process', async ({ ack, body, client, action }) => {
  await ack();
  const jobName = (action as { value?: string }).value;
  if (!jobName) return;

  const triggerId = 'trigger_id' in body ? (body as unknown as Record<string, unknown>).trigger_id as string : undefined;
  if (!triggerId) {
    console.error('No trigger_id for edit process modal');
    return;
  }

  try {
    const job = await jobsDb.getJob(jobName);
    if (!job) {
      console.error(`Job '${jobName}' not found for editing`);
      return;
    }
    await client.views.open({
      trigger_id: triggerId,
      view: buildEditProcessModal(job),
    });
  } catch (err) {
    console.error('Error opening edit process modal:', err);
  }
});

// Handle Edit Process modal submission
slackApp.view('edit_process_modal', async ({ ack, body, view, client }) => {
  const jobName = view.private_metadata;
  const values = view.state.values;

  const description = values.description_block?.description?.value?.trim() || undefined;
  const schedule = values.schedule_block?.schedule?.value?.trim() || undefined;
  const expectedEveryStr = values.expected_every_block?.expected_every_s?.value?.trim() ?? '';
  const maxRuntimeStr = values.max_runtime_block?.max_runtime_s?.value?.trim() || undefined;
  const severity = (values.severity_block?.severity as { selected_option?: { value: string } })
    ?.selected_option?.value as Severity | undefined;

  // Validate expected interval
  const expectedEveryS = parseInt(expectedEveryStr, 10);
  if (isNaN(expectedEveryS) || expectedEveryS < 1) {
    await ack({
      response_action: 'errors',
      errors: {
        expected_every_block: 'Must be a positive number of seconds (e.g. 3600 for hourly).',
      },
    });
    return;
  }

  // Validate max runtime if provided
  let maxRuntimeS: number | null | undefined;
  if (maxRuntimeStr) {
    maxRuntimeS = parseInt(maxRuntimeStr, 10);
    if (isNaN(maxRuntimeS) || maxRuntimeS < 1) {
      await ack({
        response_action: 'errors',
        errors: {
          max_runtime_block: 'Must be a positive number of seconds.',
        },
      });
      return;
    }
  }

  await ack();

  try {
    const updates: UpdateJobInput = {
      description,
      schedule,
      expectedEveryS,
      maxRuntimeS,
      severity: severity ?? 'medium',
    };
    await jobsDb.updateJob(jobName, updates);

    await activityLog.logActivity({
      jobName,
      eventType: 'job_updated',
      actor: body.user.id,
      detail: `Updated via Slack modal`,
    });

    await publishHome(client, body.user.id, 'processes');
  } catch (err) {
    console.error('Error updating process:', err);
  }
});

// Open the Add Process modal
slackApp.action('open_add_process', async ({ ack, body, client }) => {
  await ack();

  const triggerId = 'trigger_id' in body ? (body as unknown as Record<string, unknown>).trigger_id as string : undefined;
  if (!triggerId) {
    console.error('No trigger_id for add process modal');
    return;
  }

  await client.views.open({
    trigger_id: triggerId,
    view: buildAddProcessModal(),
  });
});

// Handle Add Process modal submission
slackApp.view('add_process_modal', async ({ ack, body, view, client }) => {
  const values = view.state.values;

  const jobName = values.job_name_block?.job_name?.value?.trim() ?? '';
  const description = values.description_block?.description?.value?.trim() || undefined;
  const schedule = values.schedule_block?.schedule?.value?.trim() || undefined;
  const expectedEveryStr = values.expected_every_block?.expected_every_s?.value?.trim() ?? '';
  const maxRuntimeStr = values.max_runtime_block?.max_runtime_s?.value?.trim() || undefined;
  const severity = (values.severity_block?.severity as { selected_option?: { value: string } })
    ?.selected_option?.value as Severity | undefined;

  // Validate job name
  if (!jobName || !/^[a-z0-9][a-z0-9._-]*$/.test(jobName)) {
    await ack({
      response_action: 'errors',
      errors: {
        job_name_block: 'Name must start with a letter/number and contain only lowercase letters, numbers, hyphens, dots, or underscores.',
      },
    });
    return;
  }

  // Validate expected interval
  const expectedEveryS = parseInt(expectedEveryStr, 10);
  if (isNaN(expectedEveryS) || expectedEveryS < 1) {
    await ack({
      response_action: 'errors',
      errors: {
        expected_every_block: 'Must be a positive number of seconds (e.g. 3600 for hourly).',
      },
    });
    return;
  }

  // Validate max runtime if provided
  let maxRuntimeS: number | undefined;
  if (maxRuntimeStr) {
    maxRuntimeS = parseInt(maxRuntimeStr, 10);
    if (isNaN(maxRuntimeS) || maxRuntimeS < 1) {
      await ack({
        response_action: 'errors',
        errors: {
          max_runtime_block: 'Must be a positive number of seconds.',
        },
      });
      return;
    }
  }

  // Check for duplicate
  const existing = await jobsDb.getJob(jobName);
  if (existing) {
    await ack({
      response_action: 'errors',
      errors: {
        job_name_block: `A process named "${jobName}" is already registered.`,
      },
    });
    return;
  }

  // All good — register
  await ack();

  try {
    await jobsDb.registerJob({
      jobName,
      description,
      schedule,
      expectedEveryS,
      maxRuntimeS,
      severity: severity ?? 'medium',
    });

    await activityLog.logActivity({
      jobName,
      eventType: 'job_registered',
      actor: body.user.id,
      detail: `Registered via Slack modal (expected every ${expectedEveryS}s, severity: ${severity ?? 'medium'})`,
    });

    // Refresh the processes tab
    await publishHome(client, body.user.id, 'processes');
  } catch (err) {
    console.error('Error registering process:', err);
  }
});

// Catch message events so Bolt acks them (prevents 3-second timeout warning)
slackApp.event('message', async () => {});
