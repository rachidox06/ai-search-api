import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config';
import { BrandExtractionJob } from './types';

const connection = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  tls: config.redis.tls,
});

const queue = new Queue<BrandExtractionJob>(config.queue.name, { connection });

async function testWorker() {
  console.log('🧪 Adding test job to queue...\n');
  
  const testJob: BrandExtractionJob = {
    resultId: 'test-result-123',
    answerText: `
      Here are some great project management tools:
      
      1. **Asana** - Perfect for team collaboration and task tracking
      2. **Monday.com** - Visual and intuitive project boards
      3. **Trello** - Simple kanban-style organization
      4. **Jira** - Best for software development teams
      5. **ClickUp** - All-in-one productivity platform
      
      Each tool has its strengths depending on your team's needs.
    `,
    promptId: 'test-prompt-123',
    websiteId: 'test-website-123'
  };
  
  const job = await queue.add('extract-brands', testJob, {
    attempts: config.queue.maxRetries,
    backoff: {
      type: 'exponential',
      delay: config.queue.retryDelay
    }
  });
  
  console.log(`✅ Test job added with ID: ${job.id}`);
  console.log(`📊 Check worker logs to see processing...`);
  console.log(`\nJob data:`, testJob);
  
  await connection.quit();
}

testWorker().catch(console.error);

