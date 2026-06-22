# Deployment Guide

CloudCLI UI can be deployed to a remote Linux host (e.g. Aliyun ECS) in two ways. Both build the project on GitHub Actions (so the target host never runs `npm install` — important for small instances that IO-starve under npm), but they differ in how the artifact reaches the host.

| Method | When to use | Build artifact | Delivery |
|---|---|---|---|
| **Docker via ACR** | Target host has Docker, you want isolation | Docker image pushed to Aliyun ACR | `docker pull` over Aliyun internal network |
| **SCP direct** | Target host shares user environment with the app (Python/Go/CLIs, project files), no isolation needed | Linux x64 tarball | `scp` from GitHub Actions runner to host |

Both methods are triggered automatically by pushing to `xxj_main`. Configure the one you want via GitHub Secrets — whichever set of secrets is present is the one that runs.

---

## Method A: Docker via ACR

**Workflow**: `.github/workflows/docker-publish.yml`
**Image**: pushed to Aliyun ACR, tagged `latest` + `<git-sha7>`

### Required GitHub Secrets

| Name | Example | Notes |
|---|---|---|
| `ACR_REGISTRY` | `crpi-xxxxxxxx.cn-heyuan.personal.cr.aliyuncs.com` | Personal-edition registry host, see ACR console |
| `ACR_NAMESPACE` | `xxjwulu` | Namespace you created in ACR |
| `ACR_REPOSITORY` | `ck` | Repository name (image name) |
| `ACR_USERNAME` | `wuluxxj` | **Registry login name** set when ACR was activated — NOT your Aliyun account email |
| `ACR_PASSWORD` | (fixed password) | Set via ACR → 访问凭证 → 固定密码 |

### One-time host setup

```bash
# Install Docker
curl -fsSL https://get.docker.com | sudo bash
sudo systemctl enable --now docker

# Authenticate to ACR
sudo docker login <ACR_REGISTRY>
# Username/password from the secrets above

# Create persistent data dirs (owned by the user cloudcli will run as)
sudo mkdir -p /home/<user>/.claude /home/<user>/.cloudcli
sudo chown -R <user>:<user> /home/<user>/.claude /home/<user>/.cloudcli
```

### First deploy + run

```bash
sudo docker pull <ACR_REGISTRY>/<ACR_NAMESPACE>/<ACR_REPOSITORY>:latest

sudo docker run -d --name cloudcli \
  -p 3001:3001 \
  --user $(id -u <user>):$(id -g <user>) \
  -e HOME=/home/<user> \
  -v /home/<user>:/home/<user> \
  --restart unless-stopped \
  <ACR_REGISTRY>/<ACR_NAMESPACE>/<ACR_REPOSITORY>:latest

sudo docker logs -f cloudcli
```

### Update on new build

```bash
sudo docker pull <ACR_REGISTRY>/<ACR_NAMESPACE>/<ACR_REPOSITORY>:latest
sudo docker rm -f cloudcli
# re-run the `docker run` command above
```

### Aliyun security group

Open TCP 3001 inbound (ECS console → 安全组 → 入方向).

---

## Method B: SCP direct deploy (recommended when host = developer machine)

**Workflow**: `.github/workflows/build-tarball.yml`
**Artifact**: `cloudcli-<version>-<sha7>-linux-x64.tar.gz` (~260MB), contains `dist/`, `dist-server/`, `node_modules/` (production), `public/`, `shared/`, `server/`, `package.json`.

The runner SSHes into the host, `scp`s the tarball, extracts it under `~/cloudcli`, and restarts under pm2 if present.

### Required GitHub Secrets

| Name | Example | Notes |
|---|---|---|
| `ECS_SSH_KEY` | (full private key including `-----BEGIN/END-----`) | Dedicated ed25519 key for deploy — don't reuse your personal key |
| `ECS_HOST` | `47.92.xxx.xxx` | Public IP or hostname of the target host |
| `ECS_USER` | `xxjwulu` | Linux username to deploy as. Files end up in `/home/<user>/cloudcli/` |
| `ECS_PORT` | `22` | Optional. SSH port if non-default |

### One-time host setup

```bash
# On the target host, as the deploy user (xxjwulu in this example):

# Generate a dedicated deploy key — no passphrase, ed25519
ssh-keygen -t ed25519 -f ~/.ssh/cloudcli-deploy -N "" -C "github-actions-deploy"

# Authorise it (lets GitHub Actions SSH in with the matching private key)
cat ~/.ssh/cloudcli-deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# Print the private key — copy this entire output to GitHub Secret ECS_SSH_KEY
cat ~/.ssh/cloudcli-deploy

# Install Node.js 22 (one-time, ~50MB, no IO starvation)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22

# Install pm2 for managed startup
npm install -g pm2
```

After this, in GitHub repo Settings → Secrets and variables → Actions, add the four secrets listed above. The next push to `xxj_main` auto-deploys.

### First deploy + run

The first push after secrets are configured auto-runs the workflow. Watch the `Build Linux tarball` workflow's `Deploy to ECS via SCP + SSH` step:

```
Uploading 260M to ECS ...
Extracting + restarting on ECS ...
Started via pm2.
✅ Deployed to /home/<user>/cloudcli
```

If pm2 wasn't installed when the workflow first ran, it'll print the manual command instead:

```
pm2 not installed. Run manually:
  cd /home/<user>/cloudcli && node dist-server/server/index.js
```

In that case, install pm2 and start manually:

```bash
npm install -g pm2
pm2 start /home/<user>/cloudcli/dist-server/server/index.js --name cloudcli
pm2 save
pm2 startup    # follow the command it prints to enable boot-time autostart
```

### Update on new build

Just push to `xxj_main`. The workflow re-runs and the SCP step does everything automatically:

```
git push
# wait 5-8 min, cloudcli on the host is restarted by the workflow
```

### Aliyun security group

Open TCP 3001 inbound (ECS console → 安全组 → 入方向).

---

## Common issues

### `unauthorized: authentication required` (Docker login)

`ACR_USERNAME` is the **Registry Login Name** set when ACR was activated (e.g. `wuluxxj`), not your Aliyun account email. Reset the fixed password in ACR → 访问凭证 → 固定密码 if you've forgotten it.

### `scp: stat local "***": No such file or directory`

Don't use `-p` (lowercase) for scp's port flag — scp interprets it as "preserve timestamps" and treats the port value as a local filename. Use `-o Port=N` instead, which works for both ssh and scp. The workflow already does this correctly; only an issue if you customise the SSH_OPTS array.

### `pm2` started `bash` instead of `node`

Don't wrap the entry path in quotes and don't prefix with `node`:

```bash
# Wrong — pm2 invokes /usr/bin/bash, which exits immediately
pm2 start "node /home/x/cloudcli/dist-server/server/index.js" --name cloudcli

# Right — pm2 auto-detects .js and uses the node interpreter
pm2 start /home/x/cloudcli/dist-server/server/index.js --name cloudcli
```

### `CLAUDECODE` env causes "cannot be launched inside another Claude Code session"

If the host (or the dev server) is running inside an existing Claude Code session, `CLAUDECODE=1` is in `process.env`. The spawned claude subprocess inherits it and aborts. The server-side `claude-sdk.js` and `shell-websocket.service.ts` already strip `CLAUDECODE` from the spawned env — if you fork/modify that code path, keep the `delete env.CLAUDECODE` line.

### `Claude Code native binary not found`

On Windows hosts where Claude Code is installed via npm (not the native installer), `resolveClaudeCodeExecutablePath` falls back to the JS launcher at `node_modules/@anthropic-ai/claude-code/cli.js`. The SDK detects the `.js` extension and runs it via `node` automatically. Don't try to "fix" this by forcing a `claude.exe` lookup — the npm install path is the correct one to use.

### Push to gitcode stalls / CloudWAF blocks

gitcode's CloudWAF rejects programmatic API access from GitHub Actions IPs (HTTP 418 "访问被拦截"). Don't try to mirror the tarball to gitcode via the package API or git push — both are blocked. Use the SCP direct method (Method B) instead, which has no third-party storage dependency.

### `Module did not self-register: .../better_sqlite3.node` (or other native module)

Node.js native modules compile against a specific `NODE_MODULE_VERSION` (the ABI), which differs by major version (Node 22 = ABI 127, Node 24 = ABI 137, etc). The build in `build-tarball.yml` (and `Dockerfile`) pins to a specific Node major — if the deploy target runs a different major, every native module fails to `dlopen` at startup with this error.

The fix is to make the build and the host agree on a major:

- Check what the host has: `node --version`
- Update `.github/workflows/build-tarball.yml`'s `actions/setup-node` `node-version` to the same major (and the `FROM node:XX-bookworm-slim` line in `Dockerfile` if using Method A)
- Re-run the workflow, redeploy

This is intentionally not auto-detected — pinning the build to one major produces reproducible artifacts, and changing it is a deliberate decision.

---

## Architecture notes (for agents modifying deploy)

- **Build context**: Both workflows share the same source tree and produce semantically identical artifacts. The Docker image is built via the root `Dockerfile`; the tarball is built by staging files into `$RUNNER_TEMP/cloudcli/` and tarring.
- **Native modules**: `better-sqlite3`, `bcrypt`, `node-pty`, `sharp` are platform-specific. The build happens on linux/amd64 GitHub runners, so the resulting artifact runs on any linux/x64 host with a compatible glibc (≥2.28, covers Aliyun Linux 2+, Ubuntu 18.04+, Debian 10+).
- **Path resolution at runtime**: `dist-server/` is compiled with `@/` alias resolved by `tsc-alias` to relative paths, so the extracted tree works standalone — no further install needed.
- **Auto-restart on deploy**: The SCP workflow backs up `~/cloudcli` to `~/cloudcli.bak` (only if `~/cloudcli.bak` doesn't already exist, so a failed deploy can be manually rolled back with `mv ~/cloudcli.bak ~/cloudcli`).
- **Secret masking caveat**: GitHub Actions replaces exact secret values with `***` in log output. Multi-line secrets (like an SSH key) are masked line-by-line. If a deploy step fails with `***` in the error message, the actual value is some secret — narrow down which one by checking what's in the failing command.
