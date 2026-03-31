# Troubleshooting Guide - Nanobot Environment Setup

Comprehensive troubleshooting guide for common issues encountered with nanobot deployment and operation.

## Table of Contents

1. [Installation Issues](#installation-issues)
2. [Container Issues](#container-issues)
3. [Network Issues](#network-issues)
4. [Telegram Issues](#telegram-issues)
5. [Ollama Issues](#ollama-issues)
6. [SSH Issues](#ssh-issues)
7. [Performance Issues](#performance-issues)

---

## Installation Issues

### Node.js Version Too Old

**Symptoms**:
```
npm ERR! This package requires Node.js 18 or higher
```

**Diagnosis**:
```bash
node --version
# Shows v12 or v14
```

**Solution**:
```bash
# Remove old Node.js
sudo apt remove -y nodejs libnode-dev

# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -S bash -

# Install Node.js 20
sudo apt install -y nodejs

# Verify
node --version
# Should show v20.x
```

### npm Build Failures

**Symptoms**:
```
npm ERR! code 1
npm ERR! command failed
```

**Diagnosis**:
```bash
npm install
# Fails with build errors
```

**Possible Causes**:
1. Missing build tools
2. Native module compilation issues
3. Wrong npm command

**Solutions**:

**Solution 1: Install build tools**
```bash
sudo apt install -y build-essential python3 make g++
```

**Solution 2: Use npm install instead of npm ci**
```dockerfile
# In Containerfile, change:
RUN npm ci --production
# To:
RUN npm install --production
```

**Solution 3: Remove native modules**
```bash
# Check package.json for native modules
cat package.json | grep node-pty

# Remove if not needed
npm uninstall node-pty
```

### Image Build Failures

**Symptoms**:
```
Error: error building at STEP "RUN ...": error while running runtime
```

**Diagnosis**:
```bash
sudo podman build -t nanobot:latest -f Containerfile .
# Fails at specific step
```

**Solutions**:

**Solution 1: Check base image**
```bash
# Test base image
sudo podman pull node:20-alpine
sudo podman run --rm node:20-alpine node --version
```

**Solution 2: Check for syntax errors**
```bash
# Validate Containerfile
sudo podman inspect Containerfile
```

**Solution 3: Clear cache and rebuild**
```bash
# Remove all cached layers
sudo podman rmi -a

# Rebuild without cache
sudo podman build --no-cache -t nanobot:latest -f Containerfile .
```

---

## Container Issues

### Container Won't Start

**Symptoms**:
```
sudo podman run -d nanobot
# No error, but container exits immediately
```

**Diagnosis**:
```bash
# Check container status
sudo podman ps -a | grep nanobot

# Check exit code
sudo podman inspect nanobot --format "{{.State.ExitCode}}"

# Check logs
sudo podman logs nanobot
```

**Possible Causes**:
1. Missing environment variables
2. Invalid configuration
3. Port conflicts
4. Network issues
5. Application errors

**Solutions**:

**Solution 1: Check environment variables**
```bash
# Verify .env file exists
ls -la ~/nanobot-wsl/.env

# Check required variables
grep TELEGRAM_BOT_TOKEN ~/nanobot-wsl/.env

# Test manually
cat ~/nanobot-wsl/.env
```

**Solution 2: Run container in foreground for debugging**
```bash
# Remove container first
sudo podman stop nanobot && sudo podman rm nanobot

# Run without -d flag
sudo podman run --rm \
  --name nanobot \
  --network openclaw_net \
  -v ~/nanobot-wsl/.env:/app/.env:ro \
  -e OLLAMA_BASE_URL=http://10.99.0.1:11434 \
  localhost/nanobot-wsl:latest
```

**Solution 3: Check for port conflicts**
```bash
# List all listening ports
ss -tuln | grep :3020

# If port is in use:
sudo lsof -i :3020  # Identify process
sudo kill <PID>       # Kill if safe to do so
```

### Container Keeps Restarting

**Symptoms**:
```
sudo podman ps | grep nanobot
# Shows constant restart: "Restarting (1) X seconds ago"
```

**Diagnosis**:
```bash
# Check restart count
sudo podman inspect nanobot --format "{{.RestartCount}}"

# Check exit code
sudo podman inspect nanobot --format "{{.State.ExitCode}}"

# View recent logs
sudo podman logs --tail 50 nanobot
```

**Possible Causes**:
1. Application crash on startup
2. Missing dependencies
3. Invalid configuration
4. Resource constraints

**Solutions**:

**Solution 1: Check logs for errors**
```bash
# Full logs
sudo podman logs nanobot

# Last 100 lines
sudo podman logs --tail 100 nanobot

# Follow logs
sudo podman logs -f nanobot
```

**Solution 2: Disable auto-restart**
```bash
# Stop and remove
sudo podman stop nanobot && sudo podman rm nanobot

# Run without restart policy
sudo podman run --rm \
  --name nanobot \
  --network openclaw_net \
  ~/nanobot-wsl/.env:/app/.env:ro \
  localhost/nanobot-wsl:latest
```

**Solution 3: Check resource limits**
```bash
# Check available RAM
free -h

# Check available disk
df -h

# Check CPU load
top
```

### Container Not Accessible

**Symptoms**:
```
# Container is running but can't access
sudo podman exec nanobot sh
# Error: container not running
```

**Diagnosis**:
```bash
# Check actual status
sudo podman inspect nanobot --format "{{.State.Status}}"

# Check if it's paused
sudo podman inspect nanobot --format "{{.State.Paused}}"
```

**Solutions**:

**Solution 1: Resume if paused**
```bash
sudo podman unpause nanobot
```

**Solution 2: Restart container**
```bash
sudo podman restart nanobot
```

**Solution 3: Recreate container**
```bash
sudo podman stop nanobot
sudo podman rm nanobot
sudo podman run -d ... (use your original run command)
```

---

## Network Issues

### Cannot Access Ollama

**Symptoms**:
```
# Inside container
curl http://10.99.0.1:11434/api/tags
# Connection refused or timeout
```

**Diagnosis**:
```bash
# Test from host
curl http://localhost:11434/api/tags

# Check Ollama process
pgrep ollama

# Check from container
sudo podman exec nanobot ping -c 3 10.99.0.1
```

**Possible Causes**:
1. Ollama not running
2. Wrong IP address
3. Firewall blocking
4. Network not configured correctly

**Solutions**:

**Solution 1: Start Ollama**
```bash
# Start Ollama
ollama serve > /tmp/ollama.log 2>&1 &

# Verify
curl http://localhost:11434/api/tags
```

**Solution 2: Check network gateway**
```bash
# Inspect network
sudo podman network inspect openclaw_net

# Check gateway IP
# Should show "gateway": "10.99.0.1"
```

**Solution 3: Check container network**
```bash
# Check container is on right network
sudo podman inspect nanobot --format "{{.NetworkSettings.Networks}}"

# Check container IP
sudo podman inspect nanobot --format "{{.NetworkSettings.Networks.openclaw_net.IPAddress}}"

# Should show: 10.99.0.x
```

**Solution 4: Test DNS resolution**
```bash
# Inside container
sudo podman exec nanobot nslookup 10.99.0.1

# Or test connectivity
sudo podman exec nanobot ping -c 3 10.99.0.1
```

### Cannot Connect to Workers

**Symptoms**:
```
# Inside container
ssh worker1 "echo OK"
# Connection refused or timeout
```

**Diagnosis**:
```bash
# Test SSH from host
ssh worker1 "echo OK"

# Check worker is reachable
ping -c 3 10.99.0.11

# Check container network
sudo podman inspect nanobot --format "{{.NetworkSettings.Networks.openclaw_net.IPAddress}}"
```

**Possible Causes**:
1. Workers not running
2. SSH config incorrect
3. Network isolation
4. Host key verification

**Solutions**:

**Solution 1: Verify workers are accessible**
```bash
# From host
ssh worker1 "echo OK"
ssh worker2 "echo OK"
ssh worker3 "echo OK"
```

**Solution 2: Check SSH config**
```bash
# View SSH config
sudo podman exec nanobot cat /app/config/ssh_config

# Should show:
# Host worker1
#     HostName 10.99.0.11
#     Port 2221
```

**Solution 3: Disable strict host key checking**
```bash
# Edit config
StrictHostKeyChecking no
UserKnownHostsFile /dev/null
```

**Solution 4: Test network connectivity**
```bash
# From container
sudo podman exec nanobot ping -c 3 10.99.0.11
sudo podman exec nanobot ping -c 3 10.99.0.12
sudo podman exec nanobot ping -c 3 10.99.0.13
```

---

## Telegram Issues

### Bot Not Responding

**Symptoms**:
- Send message to bot, no response
- `/start` command doesn't work

**Diagnosis**:
```bash
# Check container is running
sudo podman ps | grep nanobot

# Check logs
sudo podman logs -f nanobot

# Look for errors:
# "EFATAL: Telegram Bot Token not provided!"
# "Polling error"
```

**Possible Causes**:
1. Bot token incorrect or missing
2. Bot not started on Telegram
3. Network issues
4. Container not running

**Solutions**:

**Solution 1: Verify bot token**
```bash
# Check .env file
cat ~/nanobot-wsl/.env | grep TELEGRAM_BOT_TOKEN

# Should be in format: 123456789:ABCdefGHI...
```

**Solution 2: Verify bot is activated**
1. Open Telegram
2. Search for @BotFather
3. Send /mybots
4. Check your bot is listed
5. Click on bot name

**Solution 3: Test webhook (if using)**
```bash
# Get webhook info
curl https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo
```

**Solution 4: Check polling errors**
```bash
# View logs
sudo podman logs -f nanobot | grep polling
```

### Commands Not Working

**Symptoms**:
- `/help` doesn't show help
- `/status` doesn't work
- Commands are not recognized

**Diagnosis**:
```bash
# Check logs for command processing
sudo podman logs -f nanobot

# Send a command and watch logs
```

**Possible Causes**:
1. Command syntax changed
2. Pattern matching broken
3. Code update needed
4. Bot restarted with old code

**Solutions**:

**Solution 1: Check for code changes**
```bash
# Verify container has latest code
sudo podman exec nanobot cat /app/index.js | head -20

# Rebuild if needed
cd ~/nanobot-wsl
sudo podman stop nanobot && sudo podman rm nanobot
sudo podman build -t localhost/nanobot-wsl:latest -f Containerfile .
sudo podman run -d ... (use your run command)
```

**Solution 2: Test simple message**
```
# Send to bot: "Hello"
# Should trigger LLM response
```

**Solution 3: Check pattern matching**
```javascript
// In index.js, verify patterns are correct
bot.onText(/\/help/, async (msg) => {
  // This should work
});
```

---

## Ollama Issues

### Ollama Not Responding

**Symptoms**:
```
# From container
curl http://10.99.0.1:11434/api/tags
# Connection timeout or refused
```

**Diagnosis**:
```bash
# Check if Ollama is running
pgrep ollama

# Check port
ss -tuln | grep :11434

# Test from host
curl http://localhost:11434/api/tags
```

**Solutions**:

**Solution 1: Start Ollama**
```bash
# Start in background
ollama serve > /tmp/ollama.log 2>&1 &

# Verify
curl http://localhost:11434/api/tags
```

**Solution 2: Check Ollama logs**
```bash
# If running with logging
tail -f /tmp/ollama.log

# Or check journal
journalctl -u ollama -f
```

**Solution 3: Check port binding**
```bash
# What is Ollama listening on?
ss -tulnp | grep :11434

# Should show: 0.0.0.0:11434 or 127.0.0.1:11434
```

### Model Not Found

**Symptoms**:
```
# Error in bot logs
Error: model 'qwen2.5-coder:7b' not found
```

**Diagnosis**:
```bash
# List available models
ollama list

# Search for model
ollama list | grep qwen2.5
```

**Solution**:
```bash
# Pull the model
ollama pull qwen2.5-coder:7b

# Verify
ollama list | grep qwen2.5
```

### Ollama Slow Responses

**Symptoms**:
- Bot takes long time to respond
- Ollama requests timeout

**Diagnosis**:
```bash
# Check system resources
free -h
top

# Check Ollama process
ps aux | grep ollama
```

**Solutions**:

**Solution 1: Use smaller model**
```bash
# Edit .env
OLLAMA_MODEL=qwen2.5-coder:1.5b-instruct

# Or even smaller
OLLAMA_MODEL=qwen3:0.6b
```

**Solution 2: Check system load**
```bash
# Check what's using resources
top

# Kill unnecessary processes if safe
```

**Solution 3: Increase timeout**
```javascript
// In index.js, add timeout
const chat = await ollama.chat({
  model: OLLAMA_MODEL,
  messages: [...],
  stream: false,
  options: {
    num_ctx: 2048  // Reduce context
  }
});
```

---

## SSH Issues

### SSH Connection Refused

**Symptoms**:
```
ssh worker1 "echo OK"
# ssh: connect to host 10.99.0.11 port 2221: Connection refused
```

**Diagnosis**:
```bash
# Check if worker is running
ping -c 3 10.99.0.11

# Check SSH port
nmap -p 2221 10.99.0.11

# Try direct IP
ssh root@10.99.0.11:2221 "echo OK"
```

**Solutions**:

**Solution 1: Check worker status**
```bash
# From host
ssh worker1 "echo OK"
ssh worker2 "echo OK"
ssh worker3 "echo OK"
```

**Solution 2: Verify SSH is running on workers**
```bash
# On worker
ssh worker1 "ps aux | grep sshd"
```

**Solution 3: Check firewall**
```bash
# On host
sudo iptables -L -n | grep 2221
```

### SSH Permission Denied

**Symptoms**:
```
ssh worker1 "echo OK"
# Permission denied (publickey,password)
```

**Diagnosis**:
```bash
# Check SSH config
cat ~/.ssh/config

# Test with verbose
ssh -vvv worker1 "echo OK"
```

**Solutions**:

**Solution 1: Check SSH keys**
```bash
# List keys
ls -la ~/.ssh/

# Should have:
# id_rsa
# id_rsa.pub
# config
```

**Solution 2: Update SSH config**
```bash
# Edit config
nano ~/.ssh/config

# Add:
# Host worker1
#     HostName 10.99.0.11
#     Port 2221
#     User root
#     IdentityFile ~/.ssh/id_rsa
```

**Solution 3: Test password authentication**
```bash
# If keys not working
ssh root@10.99.0.11:2221 "echo OK"
```

---

## Performance Issues

### Bot Slow to Respond

**Symptoms**:
- Takes 10+ seconds to respond
- Commands timeout

**Diagnosis**:
```bash
# Check system load
top

# Check container resources
sudo podman stats nanobot

# Check Ollama
curl -w "@-" -o /dev/null -s "http://10.99.0.1:11434/api/tags"
```

**Solutions**:

**Solution 1: Check Ollama performance**
```bash
# Test Ollama directly
curl -X POST http://localhost:11434/api/generate \
  -d '{"model":"qwen2.5-coder:7b","prompt":"Hi","stream":false}' \
  -H "Content-Type: application/json"
```

**Solution 2: Reduce context size**
```javascript
// In index.js
const chat = await ollama.chat({
  model: OLLAMA_MODEL,
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage }
  ],
  options: {
    num_ctx: 2048  // Reduce from default
  },
  stream: false
});
```

**Solution 3: Use faster model**
```bash
# Edit .env
OLLAMA_MODEL=qwen2.5-coder:1.5b-instruct
```

### High Memory Usage

**Symptoms**:
- System becomes slow
- OOM errors in logs
- Container gets killed

**Diagnosis**:
```bash
# Check memory
free -h

# Check container memory
sudo podman stats --no-stream nanobot

# Check Ollama memory
ps aux | grep ollama
```

**Solutions**:

**Solution 1: Use smaller model**
```bash
# Edit .env
OLLAMA_MODEL=qwen2.5-coder:1.5b-instruct
```

**Solution 2: Reduce context**
```javascript
options: {
  num_ctx: 1024  // Even smaller
}
```

**Solution 3: Add swap**
```bash
# Create swap file
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## Getting Help

If none of these solutions work:

1. **Collect diagnostic information**:
```bash
# System info
uname -a
free -h
df -h

# Container info
sudo podman ps
sudo podman logs nanobot

# Network info
sudo podman network ls
sudo podman network inspect openclaw_net
```

2. **Check logs**:
```bash
sudo podman logs -f nanobot > /tmp/nanobot-debug.log 2>&1
```

3. **Search issues**:
   - Check GitHub Issues
   - Search error messages online
   - Review documentation

4. **Report issue**:
   - Include error messages
   - Include logs
   - Include system info
   - Describe steps to reproduce

---

**Version**: 1.0.0
**Last Updated**: 2026-03-31
**Author**: KiGentix Team
