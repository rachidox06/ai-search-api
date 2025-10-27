/**
 * Alerting service for brand extraction worker
 * Sends notifications to Slack
 */

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

interface AlertOptions {
  type?: 'error' | 'warning' | 'critical' | 'info';
  title: string;
  message: string;
  metadata?: Record<string, any>;
}

/**
 * Send alert to Slack
 */
async function sendAlert({ type = 'error', title, message, metadata = {} }: AlertOptions): Promise<boolean> {
  if (!SLACK_WEBHOOK_URL) {
    console.log('[Alert] No Slack webhook configured, skipping notification');
    return false;
  }

  const config = {
    critical: { emoji: '🔴', color: '#FF0000' },
    error: { emoji: '❌', color: '#FF6B6B' },
    warning: { emoji: '⚠️', color: '#FFA500' },
    info: { emoji: 'ℹ️', color: '#4A90E2' }
  };

  const { emoji } = config[type] || config.error;

  const fields = Object.entries(metadata)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({
      type: "mrkdwn",
      text: `*${key}:*\n${typeof value === 'object' ? JSON.stringify(value, null, 2) : value}`
    }));

  const slackMessage: any = {
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

  if (fields.length > 0) {
    slackMessage.blocks.push({
      type: "section",
      fields: fields.slice(0, 10)
    });
  }

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
  } catch (error: any) {
    console.error('[Alert] Error sending notification:', error.message);
    return false;
  }
}

/**
 * Alert for brand extraction failure
 */
export async function alertBrandExtractionFailed({
  resultId,
  error,
  attemptsMade
}: {
  resultId: string;
  error: string;
  attemptsMade: number;
}): Promise<boolean> {
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

