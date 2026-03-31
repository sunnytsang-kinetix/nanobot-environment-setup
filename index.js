#!/usr/bin/env node
import TelegramBot from 'node-telegram-bot-api';
import { Ollama } from 'ollama';
import { spawn } from 'child_process';

// Load .env file manually (since we're not using dotenv)
import { readFileSync } from 'fs';
const envContent = readFileSync('/app/.env', 'utf8');
const envVars = Object.fromEntries(
  envContent.split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .map(line => {
      const [key, ...valueParts] = line.split('=');
      return [key, valueParts.join('=')];
    })
);

// Configuration
const TELEGRAM_BOT_TOKEN = envVars.TELEGRAM_BOT_TOKEN;
const OLLAMA_BASE_URL = envVars.OLLAMA_BASE_URL || 'http://10.99.0.1:11434';
const OLLAMA_MODEL = envVars.OLLAMA_MODEL || 'qwen2.5-coder:7b';

if (!TELEGRAM_BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN not found in .env file');
  process.exit(1);
}

// Initialize clients
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const ollama = new Ollama({ host: OLLAMA_BASE_URL });

// MCP Servers (simple exec-based approach)
const MCP_SERVERS = {
  ssh: async (command) => {
    return new Promise((resolve, reject) => {
      const [host, ...cmdParts] = command.split(' ');
      const cmd = cmdParts.join(' ');

      const proc = spawn('ssh', [host, cmd], {
        env: { ...process.env, SSH_CONFIG_PATH: '/app/config/ssh_config' }
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout || stderr || 'Command completed successfully');
        } else {
          reject(new Error(`SSH command failed (code ${code}): ${stderr || stdout}`));
        }
      });
    });
  }
};

// System prompt
const SYSTEM_PROMPT = `You are a helpful AI assistant named KiGentix. You have access to following tools:

1. SSH - Execute commands on remote workers (worker1, worker2, worker3)
   Usage: "ssh worker1 <command>"

2. Podman - Manage containers
   Usage: "podman <command>"

You are running on WSL2 with access to:
- Local Ollama LLM (qwen2.5-coder:7b)
- SSH to worker1 (10.99.0.11:2221), worker2 (10.99.0.12:2222), worker3 (10.99.0.13:2223)
- Podman container management

Be concise and helpful. For long outputs, show only the most relevant parts.`;

// Available commands
const COMMANDS = {
  '/help': 'Show this help message',
  '/status': 'Check system status',
  '/workers': 'Check worker connectivity'
};

// Safe message handler wrapper
async function safeMessageHandler(msg, handler) {
  const chatId = msg.chat.id;
  try {
    await handler(msg, chatId);
  } catch (error) {
    // Telegram API errors (like supergroup upgrade)
    if (error.code === 'ETELEGRAM') {
      console.error('Telegram API Error:', error.message);
      // Don't try to send - it will fail again
      return;
    }
    console.error('Error processing message:', error);
    try {
      await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    } catch (sendError) {
      console.error('Failed to send error message:', sendError.message);
    }
  }
}

// Message handlers
bot.onText(/^(\/help|\/start)/, async (msg) => {
  await safeMessageHandler(msg, async (_, chatId) => {
    const helpText = `🤖 *KiGentix MCP Bot*

Available commands:
${Object.entries(COMMANDS).map(([cmd, desc]) => `• ${cmd} - ${desc}`).join('\n')}

You can also chat naturally and ask me to:
• Execute commands on workers (e.g., "Check worker1 CPU")
• Manage containers (e.g., "List all containers")
• Answer questions about your infrastructure
• Help with development tasks`;

    await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
  });
});

bot.onText(/\/status/, async (msg) => {
  await safeMessageHandler(msg, async (_, chatId) => {
    try {
      // Check Ollama
      const models = await ollama.list();
      const ollamaStatus = models.models.length > 0 ? '✅ Connected' : '❌ No models';

      // Check Ollama model specifically
      const qwenModel = models.models.find(m => m.name.includes('qwen2.5-coder:7b'));
      const modelStatus = qwenModel ? '✅ qwen2.5-coder:7b loaded' : '⚠️  qwen2.5-coder:7b not loaded';

      // Note: Podman status requires host access, skip for now
      const podmanStatus = '🐳 Podman: Check via sudo podman ps';

      const statusText = `📊 *System Status*

🤖 Ollama: ${ollamaStatus}
   ${modelStatus}
${podmanStatus}`;

      await bot.sendMessage(chatId, statusText, { parse_mode: 'Markdown' });
    } catch (error) {
      await bot.sendMessage(chatId, `❌ Error checking status: ${error.message}`);
    }
  });
});

bot.onText(/\/workers/, async (msg) => {
  await safeMessageHandler(msg, async (_, chatId) => {
    try {
      const results = [];
      for (const worker of ['worker1', 'worker2', 'worker3']) {
        try {
          const output = await MCP_SERVERS.ssh(`${worker} 'echo OK && uptime'`);
          results.push(`✅ ${worker}: ${output.trim().split('\n')[1] || 'Online'}`);
        } catch (error) {
          results.push(`❌ ${worker}: ${error.message}`);
        }
      }
      await bot.sendMessage(chatId, `🖥️ *Workers*\n\n${results.join('\n')}`, { parse_mode: 'Markdown' });
    } catch (error) {
      await bot.sendMessage(chatId, `❌ Error checking workers: ${error.message}`);
    }
  });
});

// Natural language handler
bot.on('message', async (msg) => {
  // Skip if already handled by commands or no text
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const userMessage = msg.text;

  await safeMessageHandler(msg, async (_, chatId) => {
    try {
      await bot.sendChatAction(chatId, 'typing');

      // Simple pattern matching for common tasks
      let response = '';

      // SSH to workers
      const sshMatch = userMessage.match(/(?:ssh|run|execute|check)\s+(worker[123])\s+(.+)/i);
      if (sshMatch) {
        const [, worker, command] = sshMatch;
        try {
          await bot.sendMessage(chatId, `⏳ Running \`${command}\` on ${worker}...`, { parse_mode: 'Markdown' });
          const output = await MCP_SERVERS.ssh(`${worker} '${command}'`);
          response = `✅ *${worker}*\n\`\`\`\n${output.slice(0, 2000)}${output.length > 2000 ? '\n... (truncated)' : ''}\n\`\`\``;
        } catch (error) {
          response = `❌ Error on ${worker}: ${error.message}`;
        }
      }
      // General LLM query
      else {
        const chat = await ollama.chat({
          model: OLLAMA_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage }
          ],
          stream: false
        });

        response = chat.message.content;
      }

      await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error in message handler:', error);
      await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
  });
});

// Error handler for polling
bot.on('polling_error', (error) => {
  // Suppress network/transient errors
  if (error.code === 'EFATAL' || error.code === 'ETELEGRAM') {
    // Log but don't spam
    return;
  }
  console.error(`Polling error: ${error.code} - ${error.message}`);
  // Don't crash on polling errors
});

// Log startup
console.log('🤖 KiGentix MCP Bot started!');
console.log(`📡 Telegram bot connected`);
console.log(`🧠 Ollama at ${OLLAMA_BASE_URL}`);
console.log(`🎯 Using model ${OLLAMA_MODEL}`);
