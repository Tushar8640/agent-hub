# Agent Hub

Control the coding agents on your PC (Claude Code, Antigravity, any CLI agent) from your phone.
One hub, many agents: each chat runs one agent (or a workflow such as Plan → Build) in one project.
Pair the phone by QR code; the app can be installed to the home screen (PWA).

## Requirements

- Windows 10/11
- Node.js 20.6 or newer (`node -v`)
- The agents you want to use, installed and logged in on that PC
  (for example `claude` works in a terminal; Antigravity: `agy.exe` in `%LOCALAPPDATA%\agy\bin`)

## Run on another PC

1. Copy the `agent-hub` folder to the new PC. Leave out `node_modules`, `web\node_modules`,
   `web\dist`, `data`, `logs` and `config.yaml` (they belong to the old PC).
2. Install and start:
   ```powershell
   cd <path-to>\agent-hub
   npm install
   npm start
   ```
   The first start creates `config.yaml` from `config.example.yaml`.
3. Edit `config.yaml`: set `projectRoots` (and any `projects`) to folders on this PC, then restart (`Ctrl+C`, `npm start`).
4. On the PC open **http://localhost:8650** → **Devices → Show pairing QR code**, and scan it with the phone
   (same Wi-Fi, or Tailscale).
   To install as an app: open the hub's HTTPS (Tailscale) address on the phone, then press **Install app** in Settings, or use Chrome menu → **Install app**.
5. Test with the **Echo (test)** agent first.

Background and autostart:

```powershell
scripts\start.bat     # run in the background (restarts on crash)
scripts\stop.bat      # stop
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1   # start at login
```

Logs: `logs\`. Settings and agents: `config.yaml` (see comments in `config.example.yaml`).

## Security

- Do not expose port 8650 to the internet; use Tailscale from outside your network.
- Every phone must be paired; remove lost phones under **Devices**.
- Keep `projectRoots` narrow: a paired phone can run agents in any project under those folders.
- Never put API keys or passwords in `config.yaml`.
