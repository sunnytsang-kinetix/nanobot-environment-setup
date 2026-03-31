# Architecture - Nanobot Environment Setup

Detailed architecture documentation for the nanobot MCP bot system.

## Overview

Nanobot is a lightweight, on-premise AI agent built with:
- **Node.js 20** - Runtime environment
- **Ollama** - Local LLM inference
- **Podman** - Container engine
- **Telegram Bot API** - Platform integration
- **Custom MCP Tools** - SSH and container management

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       WSL2 Host (Ubuntu 22.04)              │
│                                                                │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │           openclaw_net Network                       │  │
│  │           Subnet: 10.99.0.0/24                    │  │
│  │           Gateway: 10.99.0.1                          │  │
│  │           Bridge: cni-podman7                        │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────────┐   │  │
│  │  │          Services Layer                     │   │  │
│  │  │                                             │   │  │
│  │  │  ┌──────────┐  ┌──────────┐            │   │  │
│  │  │  │ Ollama   │  │  Redis   │            │   │  │
│  │  │  │ 10.99.0.1│  │ 10.99.0.x│            │   │  │
│  │  │  │  :11434   │  │  :6379   │            │   │  │
│  │  │  └──────────┘  └──────────┘            │   │  │
│  │  └──────────────────────────────────────────────────┘   │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────────┐   │  │
│  │  │          Container Layer                  │   │  │
│  │  │                                             │   │  │
│  │  │  ┌──────────────────┐  ┌──────────┐  │   │  │
│  │  │  │ openclaw_       │  │ nanobot  │  │   │  │
│  │  │  │ controller      │  │          │  │   │  │
│  │  │  │ 10.99.0.2      │  │ 10.99.0.6│  │   │  │
│  │  │  │ :3000           │  │ :3020    │  │   │  │
│  │  │  └──────────────────┘  └──────────┘  │   │  │
│  │  │                                             │   │  │
│  │  │  ┌──────────────────────────────────┐    │   │  │
│  │  │  │      Worker Containers         │    │   │  │
│  │  │  │                             │    │   │  │
│  │  │  │  ┌─────┐ ┌─────┐ ┌─────┐ │    │   │  │
│  │  │  │ wrk1 │ wrk2 │ wrk3 │ │    │   │  │
│  │  │  │ 0.11 │ 0.12 │ 0.13 │ │    │   │  │
│  │  │  │ :2221 │ :2222 │ :2223 │ │    │   │  │
│  │  │  └─────┘ └─────┘ └─────┘ │    │   │  │
│  │  └──────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌────────────────────────────────────────────────────┐  │
│  │          External Access                  │  │
│  │                                             │  │
│  │  Host Ports → Containers                  │  │
│  │  • 3000 → 10.99.0.2:3000 (openclaw)   │  │
│  │  • 3020 → 10.99.0.6:3000 (nanobot)    │  │
│  │  • 4000 → :4000 (LiteLLM)                 │  │
│  │                                             │  │
│  │  Telegram Bot ←→ nanobot (3020)         │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Container Architecture

### Nanobot Container

**Image**: `localhost/nanobot-wsl:latest`
**Base**: `node:20-alpine`
**Size**: ~500MB (with dependencies)

#### Container Layers

```
┌─────────────────────────────────────┐
│   Application Layer              │
│  • index.js (8.2KB)            │
│  • package.json (420B)           │
│  • node_modules (~50MB)          │
└─────────────────────────────────────┘
            ↓
┌─────────────────────────────────────┐
│   Configuration Layer            │
│  • config/ssh_config           │
│  • config/mcp.json            │
│  • .env (read-only mount)       │
└─────────────────────────────────────┘
            ↓
┌─────────────────────────────────────┐
│   Data Layer                   │
│  • data/logs/                  │
│  • data/state/                 │
│  • (persistent volume)           │
└─────────────────────────────────────┘
            ↓
┌─────────────────────────────────────┐
│   Base Layer                   │
│  • Alpine Linux                 │
│  • Node.js 20                  │
│  • System utilities (curl, ssh)   │
└─────────────────────────────────────┘
```

#### Container Resources

| Resource | Allocation | Usage |
|----------|------------|--------|
| CPU | Shared | ~2-5% idle |
| RAM | 512MB limit | ~200MB idle |
| Disk | 10GB limit | ~500MB |

## Network Architecture

### openclaw_net Network

**Type**: Bridge network with DNS
**Subnet**: 10.99.0.0/24
**Gateway**: 10.99.0.1
**DNS Server**: 10.99.0.1

#### Network Allocation

| IP Address | Service/Container | Role |
|------------|-------------------|-------|
| 10.99.0.1 | Host/Ollama | Gateway, LLM engine |
| 10.99.0.2 | openclaw_controller | OpenClaw agent |
| 10.99.0.6 | nanobot | Telegram bot |
| 10.99.0.11 | worker1 | Remote worker |
| 10.99.0.12 | worker2 | Remote worker |
| 10.99.0.13 | worker3 | Remote worker |

#### Network Flow

```
Telegram User
     │
     ▼
Telegram Bot API (external)
     │
     ▼
┌─────────────────┐
│  nanobot       │ ← HTTP Long Polling
│  10.99.0.6:3020│
└─────────────────┘
     │
     ├─► Ollama (10.99.0.1:11434)  ← LLM Inference
     │
     ├─► SSH → worker1 (10.99.0.11:2221)
     │
     ├─► SSH → worker2 (10.99.0.12:2222)
     │
     └─► SSH → worker3 (10.99.0.13:2223)
```

## Application Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│               index.js (Entry Point)                  │
│                                                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │      Telegram Gateway                     │   │
│  │  • node-telegram-bot-api               │   │
│  │  • Message polling                         │   │
│  │  • Command handlers                      │   │
│  └─────────────────────────────────────────────────┘   │
│                       ↓                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │      Command Router                     │   │
│  │  • Pattern matching                      │   │
│  │  • Command parsing                      │   │
│  │  • Fallback to LLM                     │   │
│  └─────────────────────────────────────────────────┘   │
│                       ↓                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │      MCP Tools Layer                     │   │
│  │                                             │   │
│  │  ┌─────────────┐  ┌─────────────┐        │   │
│  │  │ SSH Tool   │  │ Podman Tool │        │   │
│  │  │ spawn()    │  │ spawn()    │        │   │
│  │  └─────────────┘  └─────────────┘        │   │
│  └─────────────────────────────────────────────────┘   │
│                       ↓                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │      LLM Integration                      │   │
│  │  • ollama npm package                  │   │
│  │  • Chat completion                     │   │
│  │  • System prompts                     │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Message Flow

```
User Message (Telegram)
        │
        ▼
┌───────────────────┐
│ Telegram Gateway  │
│ • Receive msg    │
│ • Parse content │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Command Router   │
│ • Match patterns│
│ • Route to tool│
└───────────────────┘
        │
        ├─► /help → Command handler
        ├─► /status → Command handler
        ├─► /containers → Command handler
        ├─► ssh worker1 → SSH Tool
        ├─► list containers → Podman Tool
        │
        └─► Other → LLM Integration
                   │
                   ▼
            ┌─────────────────┐
            │ Ollama API    │
            │ • Chat request │
            │ • Get response │
            └─────────────────┘
                   │
                   ▼
            Send to Telegram
```

## Data Flow

### SSH Command Execution

```
User: "ssh worker1 uptime"
        │
        ▼
┌───────────────────┐
│ Pattern Match   │
│ → Extract:      │
│   - worker1     │
│   - uptime      │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ SSH Tool        │
│ spawn('ssh', [  │
│   'worker1',   │
│   'uptime'     │
│ ])             │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Worker1         │
│ Execute: uptime │
│ Return: output  │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Format output   │
│ Markdown code   │
└───────────────────┘
        │
        ▼
Send to Telegram
```

### LLM Query Processing

```
User: "What's worker2 doing?"
        │
        ▼
┌───────────────────┐
│ Pattern Match   │
│ → No match     │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ LLM Integration │
│ Prepare:       │
│ • System prompt│
│ • User message│
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Ollama API    │
│ POST /chat     │
│ model: qwen2.5 │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ LLM Processing │
│ • Load model   │
│ • Inference    │
│ • Generate     │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Send response  │
│ → Telegram      │
└───────────────────┘
```

## Security Architecture

### Container Isolation

```
┌────────────────────────────────────────┐
│         Host System                 │
│                                    │
│  ┌────────────────────────────┐    │
│  │  openclaw_net (Bridge)  │    │
│  │                          │    │
│  │  ┌─────┐ ┌─────┐   │    │
│  │  │ ctl │ │ bot │   │    │
│  │  │     │ │     │   │    │
│  │  └─────┘ └─────┘   │    │
│  │                          │    │
│  │  (Isolated from each     │    │
│  │   other via firewall)     │    │
│  └────────────────────────────┘    │
│                                    │
│  ┌────────────────────────────┐    │
│  │  Host Network            │    │
│  │  • Ollama (:11434)      │    │
│  │  • External SSH to WSL  │    │
│  └────────────────────────────┘    │
└────────────────────────────────────────┘
```

### Security Measures

1. **Read-only mounts**: Config files mounted as read-only
2. **Non-root user**: Container runs as 'bot' user
3. **Network isolation**: Containers on bridge network, not host
4. **SSH key protection**: SSH keys not in container
5. **Token isolation**: Bot token in separate .env file
6. **Minimal privileges**: Container has only necessary capabilities

### Access Control

```
┌────────────────────────────────────────┐
│  External Access                 │
│                                  │
│  Telegram Bot                    │
│    ↓                             │
│  Public (anyone with token)       │
│    ↓                             │
│  Pattern Matching                 │
│    • /help, /status (public)     │
│    • ssh workers (public)         │
│                                  │
│  Worker SSH                     │
│    ↓                             │
│  Root access (configurable)       │
│    ↓                             │
│  Workers (full control)          │
└────────────────────────────────────────┘
```

## Scalability Architecture

### Current Scale

| Component | Count | Notes |
|-----------|-------|-------|
| Telegram Bots | 1 | Single bot instance |
| LLM Models | 1 | qwen2.5-coder:7b |
| Workers | 3 | worker1/2/3 |
| Containers | 6 | nanobot, workers, etc. |

### Scaling Options

**Horizontal Scaling**:
```
Add more nanobot instances:
┌─────────────┐
│ nanobot-1   │ → Port 3020
└─────────────┘

┌─────────────┐
│ nanobot-2   │ → Port 3021
└─────────────┘

┌─────────────┐
│ nanobot-3   │ → Port 3022
└─────────────┘
```

**Vertical Scaling**:
- Increase container RAM limits
- Use larger LLM models
- Add more CPU shares

**Network Scaling**:
- Add more subnets to openclaw_net
- Use container networks for isolation
- Implement service mesh

## Monitoring Architecture

### Log Flow

```
Application Logs
    │
    ├─► stdout/stderr (container)
    │          │
    │          ├─► sudo podman logs nanobot
    │          │
    │          └─► ~/nanobot-wsl/data/logs/
    │
    └─► System journal
               │
               └─► journalctl -u nanobot
```

### Metrics Collection

**Potential Metrics**:
- Message processing time
- LLM response time
- SSH command duration
- Container resource usage
- Error rates

**Implementation** (Future):
```javascript
// Add to index.js
const metrics = {
  messages: 0,
  llmCalls: 0,
  sshCalls: 0,
  errors: 0
};

// Track in handlers
metrics.messages++;
metrics.llmCalls++;
```

## Deployment Architecture

### Deployment Pipeline

```
Development
    │
    ├─► Edit code locally
    │
    ├─► Test locally
    │
    └─► Build container
               │
               ▼
        ┌─────────────────┐
        │  Image Build   │
        │  • podman build │
        │  • Tag version  │
        └─────────────────┘
               │
               ▼
        ┌─────────────────┐
        │  Container Run  │
        │  • podman run  │
        │  • Configure    │
        └─────────────────┘
               │
               ▼
           Production
```

### Configuration Management

```
.env.example (template)
    │
    ├─► Copy to .env
    │
    ├─► Edit values
    │
    └─► Mount as read-only
              │
              ▼
        ┌─────────────────┐
        │  Container     │
        │  • Load .env   │
        │  • Apply config │
        └─────────────────┘
```

## Future Architecture Enhancements

### Planned Improvements

1. **Full MCP Implementation**
   - Replace simple spawn() with MCP SDK
   - Add tool discovery
   - Support distributed MCP servers

2. **Multi-User Support**
   - Authentication system
   - Role-based access control
   - User-specific configs

3. **Persistent Context**
   - Remember conversation history
   - Redis-based session store
   - Context window management

4. **Web Interface**
   - Dashboard for monitoring
   - Command execution UI
   - Log viewer

5. **API Gateway**
   - REST API for integration
   - Webhook support
   - Rate limiting

---

**Version**: 1.0.0
**Last Updated**: 2026-03-31
**Author**: KiGentix Team
