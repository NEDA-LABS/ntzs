#!/bin/sh
set -e

# Validate required secrets are present
: "${SUBSTRATE_PRIVATE_KEY:?SUBSTRATE_PRIVATE_KEY is required}"
: "${SIGNER_PRIVATE_KEY:?SIGNER_PRIVATE_KEY is required}"
: "${BASE_RPC_URL:?BASE_RPC_URL is required}"
: "${BUNDLER_URL:?BUNDLER_URL is required}"

# Substitute secrets into the config template at runtime
# This keeps all sensitive values out of the repository
sed \
  -e "s|__SUBSTRATE_PRIVATE_KEY__|${SUBSTRATE_PRIVATE_KEY}|g" \
  -e "s|__SIGNER_PRIVATE_KEY__|${SIGNER_PRIVATE_KEY}|g" \
  -e "s|__BASE_RPC_URL__|${BASE_RPC_URL}|g" \
  -e "s|__BUNDLER_URL__|${BUNDLER_URL}|g" \
  /simplex.toml.template > /config.toml

exec simplex
