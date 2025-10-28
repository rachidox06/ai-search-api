# AI Search Cron Scheduler

Automatically refreshes active prompts based on their individual schedules by calling the AI search API.

## What It Does

1. Runs on a schedule (default: **Every hour**)
2. Fetches prompts where `is_active = true` AND `next_run_at <= NOW()` from Supabase
3. Calls `/api/v1/prompt-runs/batch` for each due prompt
4. Updates `next_run_at` based on each prompt's `check_frequency`
5. Respects API call limits (default: 500 calls = 100 prompts max)
6. Logs progress and results

## ✨ New: Per-Prompt Scheduling

**No more fixed 2 AM schedule for everyone!** Each prompt now runs on its own schedule:

- User signs up at 3 PM → Their prompts run at 3 PM daily
- User signs up at 10 AM → Their prompts run at 10 AM daily
- **No 24-hour gap issues** - each prompt runs exactly 24 hours after its last run

## Railway Setup

### Step 1: Create New Service

1. Go to your Railway dashboard
2. Click **"New Service"**
3. Select **"From GitHub"** (or your git provider)
4. Choose your `ai-search-api` repository
5. Set **Root Directory** to: `cron-scheduler`

### Step 2: Add Environment Variables

In Railway's service settings, add these variables:

**Required:**
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (not anon key!)
- `API_URL` - Your main API URL (e.g., `https://your-api.railway.app`)

**Optional:**
- `CRON_SCHEDULE` - When to check for due prompts (default: `0 * * * *` = every hour)
- `MAX_API_CALLS_PER_RUN` - Safety limit (default: `500`)
- `SKIP_INITIAL_RUN` - Set to `true` to skip run on startup (default: `false`)
- `DRY_RUN` - Set to `true` to test without making actual API calls (default: `false`)

### Step 3: Deploy

Railway will automatically:
- Detect the Dockerfile
- Build the container
- Deploy the service
- Start the cron scheduler

**Note:** The cron will run immediately on first deploy (unless `SKIP_INITIAL_RUN=true`), then run on schedule.

## Configuration

### Cron Schedule Examples

Standard cron syntax: `minute hour day month weekday`

- `0 * * * *` - Every hour (default - recommended for per-prompt scheduling)
- `*/30 * * * *` - Every 30 minutes (more precise scheduling)
- `*/15 * * * *` - Every 15 minutes (most precise, higher overhead)
- `0 */6 * * *` - Every 6 hours (less frequent checks)

**Note:** With per-prompt scheduling, the cron just checks which prompts are due. The actual run frequency is determined by each prompt's `check_frequency` and `next_run_at` fields.

### API Call Limits

With 5 engines per prompt:
- `MAX_API_CALLS_PER_RUN=500` → 100 prompts max
- `MAX_API_CALLS_PER_RUN=400` → 80 prompts max
- `MAX_API_CALLS_PER_RUN=1000` → 200 prompts max

## Monitoring in Railway

View the **Logs** tab in your Railway service to see:
- ✅ Number of prompts due for execution
- 📅 Scheduled time vs actual run time for each prompt
- 📤 Each prompt being processed with its frequency
- ⏰ Next scheduled run time after processing
- ✅/❌ Success/failure for each request
- 📊 Summary with totals and API calls used

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **No prompts found** | Check `is_active` and `next_run_at` in Supabase prompts table |
| **Prompts not running** | Verify `next_run_at <= NOW()` for those prompts in database |
| **API errors** | Verify `API_URL` is correct and main API is running |
| **Cron not running** | Check Railway logs for errors, verify `CRON_SCHEDULE` syntax |
| **Hitting limits** | Reduce `MAX_API_CALLS_PER_RUN` or deactivate some prompts |
| **Prompts running too early/late** | Check `next_run_at` calculation - should be `last_run_at + frequency` |

## Testing Before Production

Set `DRY_RUN=true` in Railway to test without making actual API calls. Check logs to verify it finds your prompts correctly.

