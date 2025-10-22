# 🔔 Slack Cron Summary Setup

Send a daily summary of your cron job to Slack at 10 AM.

---

## 📋 What You'll Get

Every day at 10 AM UTC, you'll receive a Slack message like:

```
✅ Daily Cron Summary - 2025-10-22

Total Prompts: 45
✅ Successful: 42
❌ Failed: 3
Success Rate: 93.3%

API Calls: 168/500
Duration: 23.5s

⏰ Generated at 2025-10-22T10:00:00.000Z
```

---

## 🚀 Setup (3 Steps)

### Step 1: Create Slack Webhook

1. Go to https://api.slack.com/apps
2. Click **"Create New App"** → **"From scratch"**
3. Name it: `Cron Reports`
4. Select your workspace
5. In the left sidebar, click **"Incoming Webhooks"**
6. Toggle **"Activate Incoming Webhooks"** to **ON**
7. Click **"Add New Webhook to Workspace"**
8. Choose a channel (e.g., `#cron-reports` or `#alerts`)
9. Click **"Allow"**
10. **Copy the webhook URL** (it looks like):
    ```
    https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX
    ```

### Step 2: Add to Railway

1. Go to your Railway dashboard
2. Select your **cron-scheduler** service
3. Click **"Variables"** tab
4. Click **"New Variable"**
5. Add:
   ```
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
   ```
6. Railway will automatically redeploy

### Step 3: Wait for Next Cron Run

Your cron runs at **10 AM UTC** daily. After the next run, you'll get a Slack message!

---

## 🧪 Test It Now (Optional)

Don't want to wait? Trigger the cron manually:

### Option 1: Check Railway Logs

Your cron-scheduler runs on startup by default. Check the logs:

```
📊 Daily Cron Summary
✅ Successful: X
❌ Failed: X
[Slack] ✅ Summary sent successfully
```

### Option 2: Set SKIP_INITIAL_RUN=false

In Railway cron-scheduler variables, make sure you DON'T have:
```
SKIP_INITIAL_RUN=true
```

Then restart the service to trigger a run immediately.

---

## ⏰ Change the Time (Optional)

Don't want 10 AM UTC? Change it:

1. Go to Railway → cron-scheduler → Variables
2. Add/edit:
   ```
   CRON_SCHEDULE="0 14 * * *"
   ```
   This example changes it to 2 PM UTC (14:00)

### Cron Schedule Format

```
 ┌─── minute (0-59)
 │ ┌─── hour (0-23)
 │ │ ┌─── day of month (1-31)
 │ │ │ ┌─── month (1-12)
 │ │ │ │ ┌─── day of week (0-6, Sunday=0)
 │ │ │ │ │
 * * * * *
```

**Examples:**
- `0 10 * * *` = 10 AM daily (default)
- `0 14 * * *` = 2 PM daily
- `0 0 * * *` = Midnight daily
- `0 9 * * 1` = 9 AM every Monday
- `0 18 * * 1-5` = 6 PM weekdays only

**Convert UTC to your timezone:**
- 10 AM UTC = 5 AM EST / 2 AM PST
- 14:00 UTC = 9 AM EST / 6 AM PST

---

## 🔍 Troubleshooting

### Not receiving messages?

1. **Check Railway logs** for:
   ```
   [Slack] ✅ Summary sent successfully
   ```

2. **If you see "No webhook URL configured":**
   - Make sure you added `SLACK_WEBHOOK_URL` to Railway
   - Restart the cron-scheduler service

3. **Test the webhook manually:**
   ```bash
   curl -X POST YOUR_WEBHOOK_URL \
     -H 'Content-Type: application/json' \
     -d '{"text":"Test message"}'
   ```

4. **Check Slack app:**
   - Go to https://api.slack.com/apps
   - Select your app
   - Make sure "Incoming Webhooks" is ON
   - Make sure the webhook is active

5. **Check channel permissions:**
   - If private channel, invite the bot: `/invite @Cron Reports`

---

## 📊 What Gets Tracked

- **Total Prompts**: Number of prompts processed
- **Successful**: Prompts queued successfully
- **Failed**: Prompts that failed to queue
- **Success Rate**: Percentage successful
- **API Calls**: Calls used vs. limit
- **Duration**: How long the cron job took

---

## ✅ That's It!

You now have a simple daily summary sent to Slack. No complicated setup, just one notification per day at 10 AM.

**Summary of changes:**
- Created: `libs/slackNotifier.js` (simple Slack function)
- Modified: `cron-scheduler/index.js` (sends summary after each run)
- Schedule: 10 AM UTC daily

Need help? Check Railway logs or test the webhook URL manually.

