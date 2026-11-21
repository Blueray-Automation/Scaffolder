# Setup by Operating System

A generated project runs on **macOS**, **Ubuntu (and other Linux)** and **Windows**. The steps to install the tools differ; after that everything is the same.
Pick your system, install the tools, run the `doctor` command, and continue with [Getting Started](Getting-Started).

| System | Run the tool with | Section |
|---|---|---|
| macOS | `./scripts/sdlc <command>` | [macOS](#macos) |
| Ubuntu / Debian / other Linux | `./scripts/sdlc <command>` | [Ubuntu](#ubuntu) |
| Windows, PowerShell or cmd | `.\scripts\sdlc.cmd <command>` | [Windows (native)](#windows-native) |
| Windows with WSL2 | `./scripts/sdlc <command>` (inside Ubuntu) | [Windows with WSL2](#windows-with-wsl2) |

Wherever any page of this wiki writes `./scripts/sdlc <command>`, Windows users write `.\scripts\sdlc.cmd <command>`.
Both are tiny launchers for the same program (`scripts/sdlc.py`), so every command and option is identical.

## What every system needs

| Tool | Needed for | Version |
|---|---|---|
| Git | the integrity guard, the secret scan, your own change history | any recent |
| Python | the backend (and the `sdlc` tool itself) | **3.12 or newer** for the backend (the version in your config). The tool alone runs on 3.9+; `setup` finds a suitable Python for the backend and offers to install one |
| Node.js + npm | the web app (if you included it) | **22.12 or newer** |
| Docker | the full stack and the facts stage | optional: without it use `verify --runtime local`. Needs Compose v2 (`docker compose`) |
| An AI agent | `spec` and `implement` | optional: a CLI (`claude`, `codex`, `gemini`, `copilot` or `cursor`, installed as its own documentation says), or a desktop app: the Claude desktop app's own Claude Code (`claude-desktop`), or the Claude desktop app, Cursor or VS Code driven by you ([Using a Desktop App](Desktop-Apps)). `./scripts/sdlc agent` shows which you have and how to install the others |

`doctor` checks all of it and tells you what is missing and how to install it:

```bash
./scripts/sdlc doctor
```

## macOS

```bash
brew install git python@3.12 node
```

```bash
brew install --cask docker
```

Open Docker Desktop once so it finishes starting. macOS ships Python 3.9, which is fine for the tool itself; `setup` finds the `python@3.12` you just installed for the backend.

```bash
cd hello-scaffold
./scripts/sdlc doctor
```

## Ubuntu

On **Ubuntu 24.04**, Python 3.12 is the system Python. Install it with the venv module (without `python3-venv` Python cannot create the backend's virtual environment):

```bash
sudo apt update
sudo apt install -y git curl unzip python3 python3-venv python3-pip
```

On **Ubuntu 22.04** or older the system Python is too old for the backend. Add Python 3.12 from the deadsnakes archive, or use `uv python install 3.12` (any Linux):

```bash
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt update
sudo apt install -y python3.12 python3.12-venv
```

**Node.js 22 or newer.** Ubuntu's own `nodejs` package is older than the web app needs. One simple way is the snap:

```bash
sudo snap install node --classic --channel=22
```

(`nvm`, `fnm` or [NodeSource](https://github.com/nodesource/distributions) work equally well. Check with `node --version`.)

**Docker** (optional). Docker's own installation guide is the recommended way: <https://docs.docker.com/engine/install/ubuntu/>.
Ubuntu 24.04 also ships community packages, which are enough to get started:

```bash
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"
```

Log out and back in so the `docker` group applies. Then:

```bash
cd hello-scaffold
./scripts/sdlc doctor
```

Other Linux distributions work the same way with their own package manager: you need `git`, Python 3.12+ with its `venv` module, Node 22.12+, and optionally Docker with Compose v2.

## Windows (native)

You can work in PowerShell or the classic Command Prompt. Install the tools with `winget` (built into Windows 10 and 11):

```powershell
winget install -e --id Git.Git
winget install -e --id Python.Python.3.12
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id Docker.DockerDesktop
```

Close the terminal and open a new one so the new tools are on `PATH`. Check:

```powershell
py -3.12 --version
node --version
git --version
```

Unzip the project (right-click, *Extract All*, or `Expand-Archive hello-scaffold.zip -DestinationPath .`), then:

```powershell
cd hello-scaffold
.\scripts\sdlc.cmd doctor
.\scripts\sdlc.cmd setup
.\scripts\sdlc.cmd verify
```

How the commands translate:

| Anywhere in this wiki | On Windows |
|---|---|
| `./scripts/sdlc <command>` | `.\scripts\sdlc.cmd <command>` (in cmd: `scripts\sdlc.cmd <command>`) |
| `make up` / `make down` | `docker compose up -d --build` / `docker compose down` (`make` is not installed on Windows) |
| `chmod +x scripts/*` | not needed |
| `SDLC_PYTHON=C:\path\python.exe ./scripts/sdlc setup` | `$env:SDLC_PYTHON='C:\path\python.exe'; .\scripts\sdlc.cmd setup` |
| `rm -rf backend/.venv` | `Remove-Item -Recurse -Force backend\.venv` |
| `backend/.venv/bin/ruff` | `backend\.venv\Scripts\ruff.exe` |

Things that are different on Windows, so they do not surprise you:

- **Docker Desktop must use Linux containers** (the default) with its WSL2 backend. It has to be running for `verify` and `make up`-style commands; without it use `verify --runtime local`.
- **Keep the project in a short path** such as `C:\dev\hello-scaffold`. Deep `node_modules` folders can reach Windows' 260-character path limit; see [Troubleshooting](Troubleshooting#windows-filename-too-long-or-path-too-long).
- **Deploying from your own machine** (`sdlc deploy`) runs bash scripts, so it needs Git for Windows (which you installed above) or WSL. The generated `cd.yml` workflow deploys from a Linux runner and needs neither.
- **Line endings.** The project ships a `.gitattributes` that keeps LF line endings (batch files keep CRLF), so shell scripts and Dockerfiles survive a Windows checkout.

## Windows with WSL2

If you already use WSL2, or prefer a Linux environment, run everything inside Ubuntu and follow the [Ubuntu](#ubuntu) section there:

```powershell
wsl --install -d Ubuntu
```

- Keep the project **inside the Linux file system** (`~/hello-scaffold`), not under `/mnt/c/...`: it is much faster and avoids file-permission and line-ending trouble.
- Install Docker Desktop on Windows and enable **Settings, Resources, WSL integration** for your Ubuntu distribution, so `docker` works inside WSL.
- Use `./scripts/sdlc` exactly as on Linux.

Do not mix the two: a project created in Windows and opened from WSL (or the other way round) will have the wrong virtual environment (`.venv\Scripts` versus `.venv/bin`). Delete `backend/.venv` and run `setup` again if you switch.

## How well is each system tested?

Be aware of what has been proven:

| System | Status |
|---|---|
| macOS | The full end-to-end suite (`npm run e2e`) runs here: every gate, the facts against real processes and the Docker stack, the healing loop, `spec` and `implement` with a scripted agent. |
| Ubuntu / Linux | Covered by the repository's CI (`e2e` and `platforms` jobs). |
| Windows | Support was written without a Windows machine to run it on. The logic that differs from macOS and Linux (quoting, interpreter discovery, stopping processes, paths, UTF-8) has unit tests that simulate it, and the repository's CI runs the `platforms` smoke test on `windows-latest` (generate, `doctor`, `setup`, every gate, the facts, and a spec with non-ASCII text). Treat the first run on your own Windows machine as a real test, and report anything that fails. |

Not covered on any system: real cloud deployments, and how well a particular AI agent follows the prompts.
