import path from 'path'
import dotenv from 'dotenv'
import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'

dotenv.config({ path: path.resolve(__dirname, '../../.env') })
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true })

const baseSepoliaRpcUrl = process.env.BASE_SEPOLIA_RPC_URL
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY

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
  },
}

export default config
