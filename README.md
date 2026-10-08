# AI SHARE RPC backend

This small Node.js service serves the static site and proxies its Solana JSON-RPC calls. Configure `SOLANA_RPC_URL` in the server environment; a provider URL containing an API key stays on the server and is not embedded in the website. Payment verification, order storage, capacity fulfillment, and email delivery are intentionally outside this service.

## Run locally

From the project folder in PowerShell, copy the example configuration, edit `backend\.env` with your RPC provider URL, and start the server:

```powershell
Copy-Item .\backend\.env.example .\backend\.env
notepad .\backend\.env
node --env-file=backend/.env .\backend\server.js
```

Then open `http://localhost:8002/`. Replace `SOLANA_RPC_URL` with the RPC endpoint supplied by your provider when ready. Do not commit a private endpoint or API key. If port 8002 is occupied, choose another free port in `backend\.env`.

The proxy only accepts selected Solana RPC methods and limits each client IP to 120 requests per minute. These are basic abuse controls, not a substitute for provider-side limits and monitoring. For deployment, serve the site and `/rpc` through the same origin, bind the Node service to the hosting platform's required interface, and restrict/monitor the RPC credential at the provider.
