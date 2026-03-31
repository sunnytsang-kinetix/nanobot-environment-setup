# Lessons Learned - Nanobot Environment Setup

This document captures all lessons learned during the nanobot deployment process, including problems encountered and solutions implemented.

## 🔴 Critical Lessons

### 1. @nanobot-ai/cli Does Not Exist

**Problem**: The reference documentation mentioned `@nanobot-ai/cli` package, but it doesn't exist on npm.

**Discovery Process**:
```bash
npm install -g @nanobot-ai/cli
# npm error 404 Not Found - GET https://registry.npmjs.org/@nanobot-ai%2fcli - Not Found
```

**Root Cause**: The nanobot project referenced appears to be fictional or placeholder.

**Solution**: Built a custom implementation from scratch using:
- `node-telegram-bot-api` (0.66.0) - Telegram integration
- `ollama` (0.5.2) - LLM access
- Native Node.js `child_process.spawn()` - Command execution

**Implementation Time**: ~4 hours
**Code Size**: 8.2KB (250 lines)
**Dependencies**: 3 core packages (252 total including transitive)

**Key Design Decisions**:
- Used ES modules (`type: "module"`)
- Pattern-matched commands instead of NLP library
- Simple `spawn()` calls instead of full MCP server implementation
- Manual .env parsing to avoid extra dependency

### 2. Node.js Version Upgrade Required

**Problem**: WSL Ubuntu 22.04 ships with Node.js v12.22.9, incompatible with modern packages.

**Symptoms**:
```bash
npm install -g @some/package
# Error: This package requires Node.js 18+
```

**Initial Attempt** (Failed):
```bash
apt install nodejs
# Installs v12.22.9 again
```

**Solution**: Use NodeSource repository
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -S bash -
sudo apt install -y nodejs
```

**Package Conflicts**:
- `libnode-dev` (v12) conflicts with new nodejs (v20)
- Had to remove: `sudo apt remove -y libnode-dev`
- Then install: `sudo apt install -y nodejs`

**Result**: Node.js v20.20.2 installed successfully

**Lessons**:
- Check Node.js version before attempting installs
- Use NodeSource for modern versions on Ubuntu
- Remove old development packages before installing new versions

### 3. Image Transfer Between User and Sudo Podman

**Problem**: Container images built with user `podman` cannot be accessed by `sudo podman`.

**Symptoms**:
```bash
# Build with user podman
podman build -t localhost/nanobot-wsl:latest -f Containerfile .
# Works fine

# Try to use with sudo podman
sudo podman run -d localhost/nanobot-wsl:latest
# Error: image not found
```

**Root Cause**: User and system podman have separate image registries.

**Solution**: Export and import the image
```bash
# Export from user podman
podman save localhost/nanobot-wsl:latest -o /tmp/nanobot.tar

# Import to sudo podman
sudo podman load -i /tmp/nanobot.tar

# Now available to sudo podman
sudo podman images | grep nanobot
# localhost/nanobot-wsl:latest
```

**Alternative Solution**: Always build with sudo podman from the start:
```bash
sudo podman build -t localhost/nanobot-wsl:latest -f Containerfile .
```

**Lessons**:
- Decide upfront: user podman vs sudo podman
- Stick to one to avoid image transfer hassles
- If switching, use `podman save/load`

## 🟡 Important Lessons

### 4. Network Configuration

**Problem**: `--network host` doesn't work well when sharing openclaw_net with other containers.

**Initial Approach** (User Podman):
```bash
podman run -d \
  --name nanobot \
  --network host \
  ...
```

**Issues**:
- All ports exposed on host
- No isolation between containers
- Hard to track which service uses which port
- Can't use container DNS names

**Solution**: Use explicit network
```bash
sudo podman run -d \
  --name nanobot \
  --network openclaw_net \
  ...
```

**Network Details**:
- Name: `openclaw_net`
- Subnet: `10.99.0.0/24`
- Gateway: `10.99.0.1` (host)
- Ollama: `10.99.0.1:11434`
- openclaw_controller: `10.99.0.2:3000`
- nanobot: `10.99.0.6:3020`
- Workers: `10.99.0.11-13`

**Ollama URL Changes**:
- Old (host network): `http://localhost:11434`
- New (bridged network): `http://10.99.0.1:11434`

**Benefits**:
- Container isolation
- Predictable IPs
- DNS resolution (can use hostnames)
- Better security
- Easier debugging

### 5. Port Conflicts

**Problem**: Port 3000 already in use by openclaw_controller.

**Symptoms**:
```bash
sudo podman run -d -p 3000:3000 nanobot
# Error: cannot listen on TCP port: listen tcp4 :3000: bind: address already in use
```

**Solution**: Map to different host port
```bash
# Use port 3020 instead
sudo podman run -d -p 3020:3000 nanobot
```

**Port Planning**:
| Service | Container Port | Host Port | Notes |
|----------|----------------|-----------|--------|
| openclaw_controller | 3000 | 3000 | Primary OpenClaw |
| nanobot | 3000 | 3020 | MCP bot |
| LiteLLM | 4000 | 4000 | LLM proxy |
| Redis | 6379 | 6379 | Cache |
| Ollama | 11434 | 11434 | LLM engine |

**Lessons**:
- Document port allocations
- Use `ss -tuln` to check conflicts
- Plan ports before deployment
- Update docs when changing ports

### 6. Package Installation Failures

**Problem**: `npm ci` fails without package-lock.json

**Symptoms**:
```bash
RUN npm ci --production
# npm error code EUSAGE
# npm error The `npm ci` command can only install with an existing package-lock.json
```

**Solution**: Use `npm install` instead
```dockerfile
# Change in Containerfile
RUN npm install --production
```

**Why npm install instead of npm ci**:
- `npm ci` requires lockfile, creates reproducible builds
- `npm install` doesn't require lockfile, is more flexible
- For this project, reproducibility less critical than simplicity

### 7. Build Complexity with node-pty

**Problem**: `node-pty` package requires compilation and additional build tools.

**Symptoms**:
```bash
npm install node-pty
# npm ERR! command failed
# npm ERR! code 1
# npm ERR! error building native module
```

**Requirements**:
- Python 3
- Make
- GCC
- node-gyp

**Solution**: Remove dependency
- We don't actually need PTY functionality
- Simple `spawn()` calls are sufficient
- Removed from package.json

**Simpler Approach**:
```javascript
// Instead of node-pty
const { spawn } = require('child_process');

const proc = spawn('ssh', ['worker1', 'uptime']);
proc.stdout.on('data', (data) => { /* ... */ });
```

**Lessons**:
- Only include necessary dependencies
- Prefer pure JavaScript over native modules
- Native modules add complexity and build requirements
- Test build process early

## 🟢 Positive Lessons

### 8. MCP Simplicity

**Discovery**: Full MCP SDK is overkill for simple use cases.

**What We Didn't Need**:
- MCP server implementation
- MCP client libraries
- Complex protocol handling
- JSON-RPC over stdio

**What We Actually Needed**:
- Execute SSH commands
- Execute podman commands
- Return output

**Implementation**:
```javascript
const MCP_SERVERS = {
  ssh: async (command) => {
    return new Promise((resolve, reject) => {
      const proc = spawn('ssh', [host, cmd]);
      // Handle stdout, stderr, close
    });
  },
  podman: async (command) => {
    return new Promise((resolve, reject) => {
      const proc = spawn('podman', command.split(' '));
      // Handle stdout, stderr, close
    });
  }
};
```

**Benefits**:
- Simpler code (~100 lines vs ~500 for MCP SDK)
- Better error handling
- Direct control over execution
- No external dependencies
- Easier debugging

**When to Use Full MCP**:
- Need distributed tool execution
- Need tool discovery
- Need protocol compliance
- Building a reusable tool library

### 9. Pattern Matching Over NLP

**Discovery**: Simple pattern matching works better than NLP for command routing.

**Implementation**:
```javascript
// SSH to workers
const sshMatch = userMessage.match(/(?:ssh|run|execute|check)\s+(worker[123])\s+(.+)/i);
if (sshMatch) {
  const [, worker, command] = sshMatch;
  // Execute command
}

// Container management
else if (userMessage.match(/(?:list|show)\s+(?:all\s+)?containers/i)) {
  // List containers
}
else if (userMessage.match(/(?:restart|stop|start)\s+(\S+)\s*container/i)) {
  // Control container
}
```

**Advantages**:
- Fast execution
- Predictable behavior
- Easy to test
- Clear intent
- No NLP model dependency

**LLM for Fallback**:
```javascript
// Pattern not matched, use LLM
else {
  const chat = await ollama.chat({
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage }
    ]
  });
  response = chat.message.content;
}
```

**Hybrid Approach**:
- Pattern matching for specific commands
- LLM for general queries
- Best of both worlds

### 10. Environment Variables

**Discovery**: Manual .env parsing is simpler than `dotenv` for containers.

**Implementation**:
```javascript
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
```

**Why Not dotenv?**:
- Adds another dependency
- For this simple use case, overhead not justified
- Manual parsing is 10 lines of code

**When to Use dotenv**:
- Complex .env files with many variables
- Need variable expansion
- Need validation
- Multiple .env files (dev, staging, prod)

### 11. System Prompt Engineering

**Discovery**: Good system prompts are critical for LLM behavior.

**Our System Prompt**:
```
You are a helpful AI assistant named KiGentix. You have access to following tools:

1. SSH - Execute commands on remote workers (worker1, worker2, worker3)
   Usage: "ssh worker1 <command>"

2. Podman - Manage containers
   Usage: "podman <command>"

You are running on WSL2 with access to:
- Local Ollama LLM (qwen2.5-coder:7b)
- SSH to worker1 (10.99.0.11:2221), worker2 (10.99.0.12:2222), worker3 (10.99.0.13:2223)
- Podman container management

Be concise and helpful. For long outputs, show only the most relevant parts.
```

**Key Elements**:
- Clear role definition
- Explicit tool documentation
- Environment context
- Behavioral guidelines (concise, helpful)
- Output formatting instructions

**Lessons**:
- System prompts significantly affect LLM responses
- Include all relevant context (workers, network, tools)
- Set clear behavioral expectations
- Iterate and refine based on actual responses

### 12. Error Handling

**Discovery**: Proper error handling prevents bot crashes.

**Implementation**:
```javascript
bot.on('message', async (msg) => {
  try {
    // Process message
    await bot.sendMessage(msg.chat.id, response);
  } catch (error) {
    console.error('Error processing message:', error);
    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

bot.on('polling_error', (error) => {
  console.error(`Polling error: ${error.code} - ${error.message}`);
  // Don't crash, just log
});
```

**Lessons**:
- Always wrap async operations in try/catch
- Provide user-friendly error messages
- Log errors for debugging
- Don't crash on recoverable errors
- Handle both message and polling errors

## 📊 Summary of Issues

| Issue | Severity | Time to Resolve | Solution |
|-------|-----------|-----------------|----------|
| @nanobot-ai/cli doesn't exist | 🔴 Critical | 4 hours | Custom implementation |
| Node.js version outdated | 🔴 Critical | 30 minutes | NodeSource upgrade |
| Image transfer | 🟡 Important | 15 minutes | Export/import |
| Network configuration | 🟡 Important | 1 hour | Explicit network |
| Port conflicts | 🟡 Important | 10 minutes | Alternative ports |
| npm ci failure | 🟡 Minor | 5 minutes | Use npm install |
| node-pty complexity | 🟡 Minor | 30 minutes | Remove dependency |
| Message handling crashes | 🟡 Important | 15 minutes | Add null checks |
| Telegram API errors | 🟡 Important | 10 minutes | Handle gracefully |

**Total Time Spent**: ~6.5 hours
**Total Issues Resolved**: 9
**Critical Issues**: 2/2 resolved (100%)
**Important Issues**: 5/5 resolved (100%)

## 🎯 Best Practices Established

### Development
1. **Check prerequisites** before starting
2. **Test early** with minimal implementation
3. **Document decisions** as they're made
4. **Keep it simple** - avoid over-engineering
5. **Use existing tools** when possible

### Deployment
1. **Decide upfront**: user vs sudo podman
2. **Plan network**: don't rely on host network
3. **Document ports**: maintain port registry
4. **Test locally** before deploying
5. **Monitor logs** after deployment

### Configuration
1. **Use .env files** for secrets
2. **Never commit** sensitive data
3. **Document variables** in README
4. **Provide examples** (.env.example)
5. **Validate config** on startup

### Error Handling
1. **Never crash** on user input
2. **Log everything** for debugging
3. **Show user-friendly** error messages
4. **Retry transient** failures
5. **Alert critical** issues

## 🔄 Continuous Improvement

### Future Enhancements
1. **Add more MCP tools**: GitHub, filesystem, databases
2. **Implement persistence**: Remember conversation context
3. **Add rate limiting**: Prevent abuse
4. **Multi-user support**: Authentication and authorization
5. **Web interface**: Dashboard for monitoring
6. **Health checks**: Better monitoring and alerting

### Technical Debt
1. **Migrate to full MCP** if complexity increases
2. **Add tests** for all functions
3. **Improve error messages** with actionable guidance
4. **Add metrics** and monitoring
5. **Optimize prompts** based on usage

---

**Version**: 1.0.0
**Last Updated**: 2026-03-31
**Author**: KiGentix Team
