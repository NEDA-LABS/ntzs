import { expect } from 'chai'
import { ethers } from 'hardhat'

describe('NTZS', function () {
  it('deploys with safe admin and enforces freeze/blacklist', async function () {
    const [deployer, safeAdmin, alice, bob] = await ethers.getSigners()

    const NTZS = await ethers.getContractFactory('NTZS')
    const token: any = await NTZS.connect(deployer).deploy(await safeAdmin.getAddress())
    await token.waitForDeployment()

    const minterRole = await token.MINTER_ROLE()
    const freezerRole = await token.FREEZER_ROLE()
    const blacklisterRole = await token.BLACKLISTER_ROLE()

    await expect(token.connect(deployer).grantRole(minterRole, await deployer.getAddress())).to.not.be.reverted
    await expect(token.connect(deployer).mint(await alice.getAddress(), 100n)).to.not.be.reverted

    // Freeze blocks sending but allows receiving
    await expect(token.connect(safeAdmin).freeze(await alice.getAddress())).to.not.be.reverted
    await expect(token.connect(alice).transfer(await bob.getAddress(), 1n)).to.be.revertedWith('NTZS: sender is frozen')
    await expect(token.connect(deployer).mint(await alice.getAddress(), 1n)).to.not.be.reverted

    await expect(token.connect(safeAdmin).unfreeze(await alice.getAddress())).to.not.be.reverted

    // Blacklist blocks receiving
    await expect(token.connect(safeAdmin).blacklist(await bob.getAddress())).to.not.be.reverted
    await expect(token.connect(alice).transfer(await bob.getAddress(), 1n)).to.be.revertedWith('NTZS: recipient is blacklisted')

    // Wipe burns balance of a blacklisted address
    await expect(token.connect(deployer).mint(await bob.getAddress(), 5n)).to.be.revertedWith('NTZS: recipient is blacklisted')
    await expect(token.connect(safeAdmin).wipeBlacklisted(await bob.getAddress())).to.not.be.reverted

    // Role management: deployer can renounce admin
    await expect(token.connect(deployer).renounceDeployerAdmin()).to.not.be.reverted

    // After renounce, deployer cannot grant roles anymore
    await expect(token.connect(deployer).grantRole(freezerRole, await deployer.getAddress())).to.be.reverted
    // But safe admin still can
    await expect(token.connect(safeAdmin).grantRole(blacklisterRole, await safeAdmin.getAddress())).to.not.be.reverted
  })
})
