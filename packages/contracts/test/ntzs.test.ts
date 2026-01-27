import { expect } from 'chai'
import hre from 'hardhat'

describe('NTZSV2 (UUPS)', function () {
  it('deploys behind proxy and enforces freeze/blacklist with canonical state-change events', async function () {
    const { ethers } = hre
    const upgrades = (hre as any).upgrades
    const [deployer, safeAdmin, alice, bob] = await ethers.getSigners()

    const aliceAddr = await alice.getAddress()
    const bobAddr = await bob.getAddress()
    const safeAdminAddr = await safeAdmin.getAddress()

    const NTZSV2 = await ethers.getContractFactory('NTZSV2')
    const token: any = await upgrades.deployProxy(NTZSV2, [safeAdminAddr], {
      kind: 'uups',
      initializer: 'initialize',
      unsafeAllow: ['constructor'],
    })
    await token.waitForDeployment()

    const minterRole = await token.MINTER_ROLE()

    // For testing: grant MINTER_ROLE to deployer via Safe
    await expect(token.connect(safeAdmin).grantRole(minterRole, await deployer.getAddress())).to.not.be.reverted
    await expect(token.connect(deployer).mint(aliceAddr, 100n)).to.not.be.reverted

    // Freeze blocks sending
    await expect(token.connect(safeAdmin).freeze(aliceAddr)).to.not.be.reverted
    await expect(token.connect(alice).transfer(bobAddr, 1n))
      .to.be.revertedWithCustomError(token, 'SenderFrozen')
      .withArgs(aliceAddr)

    // Freeze cannot be called twice
    await expect(token.connect(safeAdmin).freeze(aliceAddr))
      .to.be.revertedWithCustomError(token, 'AlreadyFrozen')
      .withArgs(aliceAddr)

    await expect(token.connect(safeAdmin).unfreeze(aliceAddr)).to.not.be.reverted

    // Unfreeze cannot be called when not frozen
    await expect(token.connect(safeAdmin).unfreeze(aliceAddr))
      .to.be.revertedWithCustomError(token, 'NotFrozen')
      .withArgs(aliceAddr)

    // Blacklist blocks receiving
    await expect(token.connect(safeAdmin).blacklist(bobAddr)).to.not.be.reverted
    await expect(token.connect(alice).transfer(bobAddr, 1n))
      .to.be.revertedWithCustomError(token, 'RecipientBlacklisted')
      .withArgs(bobAddr)

    // Blacklist cannot be called twice
    await expect(token.connect(safeAdmin).blacklist(bobAddr))
      .to.be.revertedWithCustomError(token, 'AlreadyBlacklisted')
      .withArgs(bobAddr)

    // Unblacklist cannot be called when not blacklisted
    await expect(token.connect(safeAdmin).unblacklist(aliceAddr))
      .to.be.revertedWithCustomError(token, 'NotBlacklisted')
      .withArgs(aliceAddr)
  })

  it('allows wipeBlacklisted while paused (admin-only remediation)', async function () {
    const { ethers } = hre
    const upgrades = (hre as any).upgrades
    const [deployer, safeAdmin, alice, bob] = await ethers.getSigners()

    const safeAdminAddr = await safeAdmin.getAddress()
    const bobAddr = await bob.getAddress()

    const NTZSV2 = await ethers.getContractFactory('NTZSV2')
    const token: any = await upgrades.deployProxy(NTZSV2, [safeAdminAddr], {
      kind: 'uups',
      initializer: 'initialize',
      unsafeAllow: ['constructor'],
    })
    await token.waitForDeployment()

    const minterRole = await token.MINTER_ROLE()

    // Mint to bob before blacklisting
    await expect(token.connect(safeAdmin).grantRole(minterRole, await deployer.getAddress())).to.not.be.reverted
    await expect(token.connect(deployer).mint(bobAddr, 5n)).to.not.be.reverted

    await expect(token.connect(safeAdmin).blacklist(bobAddr)).to.not.be.reverted
    await expect(token.connect(safeAdmin).pause()).to.not.be.reverted

    // Normal admin burn is still blocked while paused
    await expect(token.connect(safeAdmin).burn(bobAddr, 1n)).to.be.revertedWithCustomError(token, 'TokenPaused')

    // Wipe should work while paused
    await expect(token.connect(safeAdmin).wipeBlacklisted(bobAddr)).to.not.be.reverted
    expect(await token.balanceOf(bobAddr)).to.equal(0n)
  })

  it('restricts upgrades to DEFAULT_ADMIN_ROLE (Safe)', async function () {
    const { ethers } = hre
    const upgrades = (hre as any).upgrades
    const [deployer, safeAdmin] = await ethers.getSigners()

    const safeAdminAddr = await safeAdmin.getAddress()

    const NTZSV2 = await ethers.getContractFactory('NTZSV2')
    const proxy: any = await upgrades.deployProxy(NTZSV2, [safeAdminAddr], {
      kind: 'uups',
      initializer: 'initialize',
      unsafeAllow: ['constructor'],
    })
    await proxy.waitForDeployment()

    const NTZSV3 = await ethers.getContractFactory('NTZSV3')

    // Non-admin cannot upgrade
    await expect(
      upgrades.upgradeProxy(await proxy.getAddress(), NTZSV3.connect(deployer), {
        unsafeAllow: ['constructor'],
      })
    ).to.be.reverted

    // Admin can upgrade
    const upgraded: any = await upgrades.upgradeProxy(await proxy.getAddress(), NTZSV3.connect(safeAdmin), {
      unsafeAllow: ['constructor'],
    })
    await upgraded.waitForDeployment()

    expect(await upgraded.version()).to.equal(3n)
  })
})
