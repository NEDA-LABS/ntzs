# nTZS Market Maker (Simplex / HyperFX)

Automated market maker for the nTZS/USDC pair using HyperBridge's Simplex bot
and the HyperFX strategy. Runs as a persistent background process on Fly.io.

## How It Works

- Simplex watches Base mainnet for HyperBridge `OrderPlaced` events
- When a user wants to swap USDC -> nTZS or nTZS -> USDC, this bot fills the order
- The bot earns the spread between the bid and ask price curves configured in `simplex.toml.template`
- The solver wallet holds both nTZS and USDC as inventory

## Prerequisites

Before deploying, you need:

1. **Fly.io account** - https://fly.io (free tier is sufficient)
2. **Fly CLI** - `brew install flyctl` then `fly auth login`
3. **Pimlico API key** - https://pimlico.io (ERC-4337 bundler for Base)
4. **Hyperbridge Substrate keypair** - generate with:
   ```sh
   # Install subkey (Substrate key tool)
   cargo install --force subkey --git https://github.com/paritytech/polkadot-sdk
   subkey generate
   # Save the "Secret seed" - this is your SUBSTRATE_PRIVATE_KEY
   ```
5. **Dedicated solver wallet** - a new EVM wallet separate from the treasury

## Solver Wallet Funding

The solver wallet is the bot's inventory wallet. Fund it with:

| Asset | Amount | Purpose |
|-------|--------|---------|
| nTZS | 500,000 minimum | Sell-side inventory (USDC -> nTZS orders) |
| USDC | 500 minimum | Buy-side inventory (nTZS -> USDC orders) |
| ETH (Base) | 0.01 | Gas for `fillOrder` transactions |

To fund nTZS: send from treasury wallet to solver wallet address.
To fund USDC: send USDC on Base mainnet to solver wallet address.

The bot will top up its ERC-4337 EntryPoint deposit automatically from the solver wallet's ETH balance.

## Deployment

### 1. Create the Fly.io app

```sh
cd apps/market-maker
fly apps create ntzs-market-maker
```

### 2. Set secrets

```sh
fly secrets set \
  SUBSTRATE_PRIVATE_KEY="0x..." \
  SIGNER_PRIVATE_KEY="0x..." \
  BASE_RPC_URL="https://base-mainnet.g.alchemy.com/v2/YOUR_KEY" \
  BUNDLER_URL="https://api.pimlico.io/v2/base/rpc?apikey=YOUR_PIMLICO_KEY" \
  --app ntzs-market-maker
```

- `SUBSTRATE_PRIVATE_KEY` - Hyperbridge Substrate keypair secret seed (from step 4 above)
- `SIGNER_PRIVATE_KEY` - solver wallet private key (NOT the treasury)
- `BASE_RPC_URL` - Alchemy Base mainnet URL (same one used by the web app)
- `BUNDLER_URL` - Pimlico bundler URL for Base

### 3. Deploy

```sh
fly deploy --app ntzs-market-maker
```

### 4. Verify it is running

```sh
fly logs --app ntzs-market-maker
```

You should see Simplex start up, connect to Hyperbridge, and begin watching for orders.

## Updating Price Curves

The price curves in `simplex.toml.template` use static values tied to the current TZS/USD rate.
Check the rate at https://www.google.com/search?q=TZS+USD and update as needed.

Current configuration (update when rate shifts more than 2%):

| Rate | bid range | ask range |
|------|-----------|-----------|
| 1 USD = 2600 nTZS (current) | 2604-2620 | 2564-2580 |

To update the rate:
1. Edit `simplex.toml.template` - adjust all `price` values in both curves proportionally
2. Commit and push
3. Run `fly deploy --app ntzs-market-maker` to apply

Example: if TZS weakens to 2700/USD, add ~100 to all bid and ask price values.

## Monitoring

```sh
# Live logs
fly logs --app ntzs-market-maker

# Machine status
fly status --app ntzs-market-maker

# SSH into the machine
fly ssh console --app ntzs-market-maker
```

## Restarting

```sh
fly machine restart --app ntzs-market-maker
```

## Inventory Management

Monitor the solver wallet balance regularly. If either balance runs low:

- **nTZS depleted**: send more nTZS from treasury to solver wallet address
- **USDC depleted**: send USDC on Base to solver wallet address
- **ETH depleted**: send a small amount of ETH on Base for gas (0.01 ETH is plenty)

The solver wallet address can be derived from the `SIGNER_PRIVATE_KEY`.
