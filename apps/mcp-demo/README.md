# @split402/mcp-demo

MCP-facing demo bundle and stdio gateway for the Split402 public-alpha paid tool
flow.

The package describes one agent-callable paid tool, the x402 payment
requirement, the Split402 referral campaign, receipt verification expectations,
and the commands needed to run the local proof loop. It can also run as a small
MCP stdio gateway for clients that want to inspect or call the demo tool through
MCP directly.

## Tool Card

```mermaid
flowchart LR
  Agent["MCP agent"]
  Tool["split402.walletRiskScore"]
  Payment["x402 exact payment"]
  Merchant["Split402 demo merchant"]
  Receipt["Signed Split402 receipt"]
  Referrer["Referrer credit"]

  Agent --> Tool
  Tool --> Payment
  Payment --> Merchant
  Merchant --> Receipt
  Receipt --> Referrer
```

## Generate The Bundle

```bash
corepack pnpm demo:mcp-bundle
```

The command emits deterministic JSON that can be copied into MCP-client or
agent-runner configuration while the real demo server is running locally.

## Run The Gateway

```bash
corepack pnpm demo:mcp-gateway
```

The gateway supports `initialize`, `tools/list`, and `tools/call` over stdio
JSON-RPC. It exposes:

- `split402.walletRiskScore` for the original paid HTTP request metadata;
- `split402.searchCapabilities` for router provider discovery;
- `split402.execute` for a router-backed demo execution result;
- `split402.getReceipt` for receipts captured during the current gateway
  session.

The default CLI gateway uses a router-backed mock executor with a
merchant-signed demo receipt so agents can exercise discovery, execution result
shape, and receipt verification without a live funded buyer wallet. It is not a
claim of production MCP hosting or mainnet-ready payment execution.

Example `tools/call` request:

```json
{
  "jsonrpc": "2.0",
  "id": "execute-1",
  "method": "tools/call",
  "params": {
    "name": "split402.execute",
    "arguments": {
      "capability": "solana.wallet-risk",
      "input": {
        "wallet": "wallet-address"
      },
      "budget": {
        "maxAmountAtomic": "50000"
      },
      "referralClaim": {
        "protocolVersion": "0.1",
        "routeId": "rte_...",
        "campaignId": "cmp_...",
        "campaignVersion": 1,
        "referrerWallet": "referrer-wallet",
        "payoutWallet": "payout-wallet",
        "expiresAt": "2026-06-27T00:00:00Z",
        "nonce": "claim-nonce",
        "signature": {
          "scheme": "ed25519",
          "publicKey": "referrer-public-key",
          "value": "signature"
        }
      }
    }
  }
}
```

When `network` or `asset` are omitted from `budget`, the gateway defaults them
from the selected provider and still enforces `maxAmountAtomic`. `referralClaim`
is optional; when present, the gateway validates the Split402 claim schema before
forwarding it into the router execution.

### Control-Plane Discovery Mode

Set `SPLIT402_MCP_CONTROL_PLANE_URL` to let the gateway build its router from
active Split402 routes exposed by the control plane:

```bash
SPLIT402_MCP_CONTROL_PLANE_URL=https://control.staging.example \
SPLIT402_MCP_CONTROL_PLANE_TOKEN=... \
SPLIT402_MCP_CAPABILITY=solana.wallet-risk \
SPLIT402_MCP_SVM_PRIVATE_KEY=<funded-buyer-key-base58> \
corepack pnpm demo:mcp-gateway
```

Optional filters:

- `SPLIT402_MCP_RESOURCE_ORIGIN`
- `SPLIT402_MCP_OPERATION_ID`
- `SPLIT402_MCP_DISCOVERY_LIMIT`

In this mode `split402.searchCapabilities` uses active control-plane routes and
their Bazaar resource projections. `split402.execute` uses the router's normal
agent SDK executor and therefore still requires the surrounding live x402 buyer
configuration to be valid. Set `SPLIT402_MCP_SVM_PRIVATE_KEY` to a funded
Solana buyer key encoded as base58 bytes, or use the existing demo-agent
`SVM_PRIVATE_KEY` environment variable. This remains a public-alpha gateway
path, not a production hosted MCP service.

## Proof Commands

```bash
corepack pnpm demo:merchant
corepack pnpm demo:inspect-offer
corepack pnpm demo:mcp-bundle
corepack pnpm demo:paid-suite
```

Run `corepack pnpm demo:mcp-gateway` in an MCP client stdio session when the
proof needs direct MCP tool discovery.

Run the deterministic local gateway smoke proof before attaching hosted
evidence:

```bash
corepack pnpm demo:mcp-gateway:smoke
```

The smoke command initializes the gateway, lists the router tools, executes
`split402.execute` in demo-router mode, and retrieves the captured receipt with
`split402.getReceipt`.

## Status

Phase 7 public-alpha bundle and stdio gateway for agent-facing tooling. It is
not a production hosted MCP service. The default `split402.execute` path is a
router demo mode, not a live x402 payment. Control-plane discovery mode can list
real active route providers and uses the router's agent SDK executor for live
execution attempts.
