import path from 'path'
import dotenv from 'dotenv'
import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import '@openzeppelin/hardhat-upgrades'

dotenv.config({ path: path.resolve(__dirname, '../../.env') })
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true })

const baseSepoliaRpcUrl = process.env.BASE_SEPOLIA_RPC_URL
const baseMainnetRpcUrl = process.env.BASE_RPC_URL
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
const basescanApiKey = process.env.BASESCAN_API_KEY || ''

const accounts = deployerPrivateKey ? [deployerPrivateKey] : []

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    baseSepolia: {
      url: baseSepoliaRpcUrl || '',
      accounts,
      chainId: 84532,
    },
    base: {
      url: baseMainnetRpcUrl || '',
      accounts,
      chainId: 8453,
    },
  },
  etherscan: {
    apiKey: basescanApiKey,
    customChains: [
      {
        network: 'base',
        chainId: 8453,
        urls: {
          apiURL: 'https://api.basescan.org/api',
          browserURL: 'https://basescan.org',
        },
      },
      {
        network: 'baseSepolia',
        chainId: 84532,
        urls: {
          apiURL: 'https://api-sepolia.basescan.org/api',
          browserURL: 'https://sepolia.basescan.org',
        },
      },
    ],
  },
}

export default config
