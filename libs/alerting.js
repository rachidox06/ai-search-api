/**
 * Centralized Alerting System
 * Sends error notifications to Slack for monitoring Railway API health
 */

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

/**
 * Send a Slack alert
 * @param {Object} options - Alert options
 * @param {string} options.type - Alert type (error, warning, critical)
 * @param {string} options.title - Alert title
 * @param {string} options.message - Alert message
 * @param {Object} options.metadata - Additional context
 */
export async function sendAlert({ type = 'error', title, message, metadata = {} }) {
  if (!SLACK_WEBHOOK_URL) {
    console.log('[Alert] No Slack webhook configured, skipping notification');
    return false;
  }

  // Choose emoji and color based on type
  const config = {
    critical: { emoji: '🔴', color: '#FF0000' },
    error: { emoji: '❌', color: '#FF6B6B' },
    warning: { emoji: '⚠️', color: '#FFA500' },
    info: { emoji: 'ℹ️', color: '#4A90E2' }
  };

  const { emoji, color } = config[type] || config.error;

  // Build fields from metadata
  const fields = Object.entries(metadata)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({
      type: "mrkdwn",
      text: `*${key}:*\n${typeof value === 'object' ? JSON.stringify(value, null, 2) : value}`
    }));

  const slackMessage = {
    text: `${emoji} ${title}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${emoji} ${title}`,
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: message
        }
      }
    ]
  };

  // Add metadata fields if any
  if (fields.length > 0) {
    slackMessage.blocks.push({
      type: "section",
      fields: fields.slice(0, 10) // Max 10 fields per section
    });
  }

  // Add timestamp
  slackMessage.blocks.push({
    type: "context",
    elements: [{
      type: "mrkdwn",
      text: `⏰ ${new Date().toISOString()}`
    }]
  });

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackMessage)
    });

    if (!response.ok) {
      console.error('[Alert] Failed to send Slack notification:', response.status);
      return false;
    }

    console.log(`[Alert] ✅ ${type.toUpperCase()} alert sent: ${title}`);
    return true;
  } catch (error) {
    console.error('[Alert] Error sending notification:', error.message);
    return false;
  }
}

/**
 * Alert for job failure after all retries
 */
export async function alertJobFailed({ engine, promptId, jobId, error, attemptsMade }) {
  return await sendAlert({
    type: 'error',
    title: `Job Failed After ${attemptsMade} Retries`,
    message: `*Engine:* ${engine}\n*Error:* ${error}`,
    metadata: {
      'Prompt ID': promptId,
      'Job ID': jobId,
      'Attempts': attemptsMade,
      'Service': `worker.${engine}`
    }
  });
}

/**
 * Alert for brand extraction failure
 */
export async function alertBrandExtractionFailed({ resultId, error, attemptsMade }) {
  return await sendAlert({
    type: 'error',
    title: `Brand Extraction Failed After ${attemptsMade} Retries`,
    message: `*Error:* ${error}`,
    metadata: {
      'Result ID': resultId,
      'Attempts': attemptsMade,
      'Service': 'brand-extraction-worker'
    }
  });
}

/**
 * Alert for NULL extracted_brands detected
 */
export async function alertNullBrands({ resultId, engine, age, answerLength }) {
  return await sendAlert({
    type: 'warning',
    title: 'NULL Brands Detected',
    message: `Result has NULL extracted_brands after ${age}`,
    metadata: {
      'Result ID': resultId,
      'Engine': engine,
      'Age': age,
      'Answer Length': answerLength ? `${answerLength} chars` : 'N/A',
      'Service': 'monitoring'
    }
  });
}

/**
 * Alert for brand extraction not queued
 */
export async function alertBrandExtractionNotQueued({ resultId, reason }) {
  return await sendAlert({
    type: 'warning',
    title: 'Brand Extraction NOT Queued',
    message: `Result was saved but brand extraction was not queued.\n*Reason:* ${reason}`,
    metadata: {
      'Result ID': resultId,
      'Service': 'worker'
    }
  });
}

/**
 * Alert for Redis connection failure
 */
export async function alertRedisConnectionLost({ service, error }) {
  return await sendAlert({
    type: 'critical',
    title: 'Redis Connection Lost',
    message: `*Service:* ${service}\n*Error:* ${error}`,
    metadata: {
      'Service': service,
      'Action Required': 'Check Redis connectivity in Railway'
    }
  });
}

/**
 * Alert for Supabase connection failure
 */
export async function alertSupabaseFailure({ service, operation, error }) {
  return await sendAlert({
    type: 'critical',
    title: 'Supabase Operation Failed',
    message: `*Operation:* ${operation}\n*Error:* ${error}`,
    metadata: {
      'Service': service,
      'Action Required': 'Check Supabase connectivity'
    }
  });
}

/**
 * Alert for empty API response
 */
export async function alertEmptyResponse({ resultId, engine, promptId }) {
  return await sendAlert({
    type: 'warning',
    title: 'Empty API Response',
    message: `API returned empty or very short response`,
    metadata: {
      'Result ID': resultId,
      'Engine': engine,
      'Prompt ID': promptId,
      'Service': `worker.${engine}`
    }
  });
}

/**
 * Alert for batch completion with missing engines
 */
export async function alertMissingEngines({ promptId, expectedEngines, completedEngines, missingEngines }) {
  return await sendAlert({
    type: 'warning',
    title: 'Incomplete Batch - Missing Engines',
    message: `Expected ${expectedEngines.length} engines, only ${completedEngines.length} completed`,
    metadata: {
      'Prompt ID': promptId,
      'Expected': expectedEngines.join(', '),
      'Completed': completedEngines.join(', '),
      'Missing': missingEngines.join(', '),
      'Service': 'batch-monitor'
    }
  });
}

export default {
  sendAlert,
  alertJobFailed,
  alertBrandExtractionFailed,
  alertNullBrands,
  alertBrandExtractionNotQueued,
  alertRedisConnectionLost,
  alertSupabaseFailure,
  alertEmptyResponse,
  alertMissingEngines
};

