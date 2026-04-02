#!/usr/bin/env node
import TelegramBot from 'node-telegram-bot-api';
import { Ollama } from 'ollama';
import { spawn } from 'child_process';

// Load .env file manually
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
const OLLAMA_BASE_URL = envVars.OLLAMA_BASE_URL || 'http://host.containers.internal:11434';
const OLLAMA_MODEL = envVars.OLLAMA_MODEL || 'qwen2.5-coder:7b';
const WSL_HOST = envVars.WSL_HOST || '172.19.32.79';
const WSL_USER = envVars.WSL_USER || 'sunnytsang';
const WSL_PASSWORD = envVars.WSL_PASSWORD || 'wslpassword';

if (!TELEGRAM_BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN not found in .env file');
  process.exit(1);
}

// Initialize clients
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const ollama = new Ollama({ host: OLLAMA_BASE_URL });

// MCP Servers
const MCP_SERVERS = {
  // SSH to workers (passwordless)
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
  },

  // SSH to WSL (with sshpass)
  wsl: async (command) => {
    return new Promise((resolve, reject) => {
      const proc = spawn('sshpass', [
        '-p', WSL_PASSWORD,
        'ssh',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        `${WSL_USER}@${WSL_HOST}`,
        command
      ]);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout || stderr || 'Command completed successfully');
        } else {
          reject(new Error(`WSL command failed (code ${code}): ${stderr || stdout}`));
        }
      });
    });
  },

  // Podman (local container)
  podman: async (command) => {
    return new Promise((resolve, reject) => {
      const proc = spawn('podman', command.split(' '), {
        env: { ...process.env, XDG_RUNTIME_DIR: '/run/user/1000' }
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0 || code === null) {
          resolve(stdout || stderr || 'Command completed');
        } else {
          reject(new Error(`Podman command failed (code ${code}): ${stderr || stdout}`));
        }
      });
    });
  }
};

// System prompt
const SYSTEM_PROMPT = `You are a helpful AI assistant named KiGentix. You have access to the following tools:

1. SSH - Execute commands on remote workers (worker1, worker2, worker3)
   Usage: "ssh worker1 <command>"

2. WSL - Execute commands on the WSL host (172.19.32.79)
   Usage: "wsl <command>" or "ssh wsl <command>"

3. Podman - Manage containers
   Usage: "podman <command>"

You are running on WSL2 with access to:
- Local Ollama LLM (${OLLAMA_MODEL})
- SSH to workers (worker1-3) and WSL host
- Podman container management

Be concise and helpful. For long outputs, show only the most relevant parts.`;

// Available commands
const COMMANDS = {
  '/help': 'Show this help message',
  '/status': 'Check system status',
  '/containers': 'List running containers',
  '/workers': 'Check worker connectivity',
  '/wsl': 'Check WSL host status'
};

// Message handler
bot.onText(/^(\/help|\/start)/, async (msg) => {
  const helpText = `🤖 *KiGentix MCP Bot*

Available commands:
${Object.entries(COMMANDS).map(([cmd, desc]) => `• ${cmd} - ${desc}`).join('\n')}

You can also chat naturally and ask me to:
• Execute commands on workers (e.g., "ssh worker1 uptime")
• Execute commands on WSL host (e.g., "wsl podman ps")
• Manage containers (e.g., "list all containers")
• Answer questions about your infrastructure`;

  await bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
  try {
    // Check Ollama
    const models = await ollama.list();
    const ollamaStatus = models.models.length > 0 ? '✅ Connected' : '❌ No models';

    // Check Podman (local)
    let localContainers = [];
    try {
      const podmanOutput = await MCP_SERVERS.podman('ps --format "{{.Names}}"');
      localContainers = podmanOutput.trim().split('\n').filter(Boolean);
    } catch (e) {
      // Podman might not be available in container
    }
    const podmanStatus = localContainers.length > 0 ? `✅ ${localContainers.length} running` : '⚠️ N/A (in container)';

    const statusText = `📊 *System Status*

🤖 Ollama: ${ollamaStatus}
🐳 Podman: ${podmanStatus}

*Local containers:*
${localContainers.map(c => `  • ${c}`).join('\n') || '  None'}`;

    await bot.sendMessage(msg.chat.id, statusText, { parse_mode: 'Markdown' });
  } catch (error) {
    await bot.sendMessage(msg.chat.id, `❌ Error checking status: ${error.message}`);
  }
});

bot.onText(/\/containers/, async (msg) => {
  try {
    // Try WSL containers first
    const output = await MCP_SERVERS.wsl('sudo podman ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"');
    await bot.sendMessage(msg.chat.id, `📦 *WSL Containers*\n\`\`\`\n${output}\n\`\`\``, { parse_mode: 'Markdown' });
  } catch (error) {
    await bot.sendMessage(msg.chat.id, `❌ Error listing containers: ${error.message}`);
  }
});

bot.onText(/\/workers/, async (msg) => {
  const results = [];
  for (const worker of ['worker1', 'worker2', 'worker3']) {
    try {
      const output = await MCP_SERVERS.ssh(`${worker} 'echo OK && uptime'`);
      results.push(`✅ ${worker}: ${output.trim().split('\n')[1] || 'Online'}`);
    } catch (error) {
      results.push(`❌ ${worker}: ${error.message}`);
    }
  }
  await bot.sendMessage(msg.chat.id, `🖥️ *Workers*\n\n${results.join('\n')}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/wsl/, async (msg) => {
  try {
    const uptime = await MCP_SERVERS.wsl('uptime');
    const pods = await MCP_SERVERS.wsl('sudo podman pod ps --format "{{.Name}}: {{.Status}}"');
    const containers = await MCP_SERVERS.wsl('sudo podman ps --format "{{.Names}}" | wc -l');
    
    const statusText = `🖥️ *WSL Host (172.19.32.79)*

⏱️ Uptime: ${uptime.trim()}
📦 Containers: ${containers.trim()} running
_Pods:_
${pods.trim() || '  None'}`;

    await bot.sendMessage(msg.chat.id, statusText, { parse_mode: 'Markdown' });
  } catch (error) {
    await bot.sendMessage(msg.chat.id, `❌ Error checking WSL: ${error.message}`);
  }
});

// Natural language handler
bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return; // Skip commands already handled

  const chatId = msg.chat.id;
  const userMessage = msg.text;

  try {
    await bot.sendChatAction(chatId, 'typing');

    let response = '';

    // SSH to WSL host
    const wslMatch = userMessage.match(/^(?:wsl|ssh\s+wsl)\s+(.+)$/i);
    if (wslMatch) {
      const command = wslMatch[1];
      try {
        await bot.sendMessage(chatId, `⏳ Running \`${command}\` on WSL...`, { parse_mode: 'Markdown' });
        const output = await MCP_SERVERS.wsl(command);
        response = `✅ *WSL Host*\n\`\`\`\n${output.slice(0, 3000)}${output.length > 3000 ? '\n... (truncated)' : ''}\n\`\`\``;
      } catch (error) {
        response = `❌ Error on WSL: ${error.message}`;
      }
    }
    // SSH to workers
    else if (userMessage.match(/(?:ssh|run|execute|check)\s+(worker[123])\s+(.+)/i)) {
      const [, worker, command] = userMessage.match(/(?:ssh|run|execute|check)\s+(worker[123])\s+(.+)/i);
      try {
        await bot.sendMessage(chatId, `⏳ Running \`${command}\` on ${worker}...`, { parse_mode: 'Markdown' });
        const output = await MCP_SERVERS.ssh(`${worker} '${command}'`);
        response = `✅ *${worker}*\n\`\`\`\n${output.slice(0, 3000)}${output.length > 3000 ? '\n... (truncated)' : ''}\n\`\`\``;
      } catch (error) {
        response = `❌ Error on ${worker}: ${error.message}`;
      }
    }
    // List containers (WSL by default)
    else if (userMessage.match(/^(?:list|show)\s+(?:all\s+)?containers$/i)) {
      const output = await MCP_SERVERS.wsl('sudo podman ps -a --format "table {{.Names}}\\t{{.Status}}\\t{{.Image}}"');
      response = `📦 *All Containers (WSL)*\n\`\`\`\n${output}\n\`\`\``;
    }
    // Container management on WSL
    else if (userMessage.match(/(?:restart|stop|start)\s+(?:container\s+)?(\S+)/i)) {
      const match = userMessage.match(/(restart|stop|start)\s+(?:container\s+)?(\S+)/i);
      const action = match[1].toLowerCase();
      const container = match[2];
      
      if (container.match(/^(worker|nanobot|openclaw|tvms|litellm|redis)/i)) {
        const output = await MCP_SERVERS.wsl(`sudo podman ${action} ${container}`);
        response = `✅ Container \`${container}\` ${action}ed\n\`\`\`\n${output}\n\`\`\``;
      } else {
        response = `❓ Unknown container. Try: worker1, worker2, worker3, nanobot, openclaw, tvms, litellm, redis`;
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
    console.error('Error processing message:', error);
    await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Error handler
bot.on('polling_error', (error) => {
  console.error(`Polling error: ${error.code} - ${error.message}`);
});

console.log('🤖 KiGentix MCP Bot started!');
console.log(`📡 Telegram bot connected`);
console.log(`🧠 Ollama at ${OLLAMA_BASE_URL}`);
console.log(`🎯 Using model ${OLLAMA_MODEL}`);
console.log(`🖥️ WSL access: ${WSL_USER}@${WSL_HOST}`);