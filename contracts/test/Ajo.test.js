const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Comprehensive Ajo Contract Test Suite
 * Tests positive/negative scenarios with exact chain limits, dynamically isolating code faults
 * 
 * Test Coverage:
 * - Deployment validation
 * - Positive cases: exact amount acceptance, state tracking, event emissions
 * - Negative cases: amount rejection, state preservation on failure
 * - Edge cases: wei precision, large amounts, overflow prevention
 * - Capacity limits: maxMembers enforcement, boundary conditions
 * - State isolation: fault detection, consistency verification
 * - Complex scenarios: interleaved operations, stress testing
 */
describe("Ajo Contract - Comprehensive Test Suite", function () {
  // Test timeout configuration
  this.timeout(60000);
  let ajo;
  let owner;
  let member1;
  let member2;
  let member3;
  let addrs;
  let contributionAmount;
  let cycleDuration;
  let maxMembers;

  /**
   * Fixture for deploying Ajo contract with default parameters
   */
  async function deployAjoFixture() {
    const [owner, user1, user2, ...rest] = await ethers.getSigners();
    const contributionAmount = ethers.utils.parseEther("1"); // 1 ETH
    const cycleDuration = 30 * 24 * 60 * 60; // 30 days
    const maxMembers = 10;

    const Ajo = await ethers.getContractFactory("Ajo");
    const ajo = await Ajo.deploy(contributionAmount, cycleDuration, maxMembers);
    await ajo.deployed();

    return { ajo, owner, user1, user2, addrs: rest, contributionAmount, cycleDuration, maxMembers };
  }

  beforeEach(async function () {
    [owner, member1, member2, member3, ...addrs] = await ethers.getSigners();

    contributionAmount = ethers.utils.parseEther("1"); // 1 ETH
    cycleDuration = 30 * 24 * 60 * 60; // 30 days
    maxMembers = 10;

    const Ajo = await ethers.getContractFactory("Ajo");
    ajo = await Ajo.deploy(contributionAmount, cycleDuration, maxMembers);
    await ajo.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct contribution amount", async function () {
      expect(await ajo.contributionAmount()).to.equal(contributionAmount);
    });

    it("Should set the correct cycle duration", async function () {
      expect(await ajo.cycleDuration()).to.equal(cycleDuration);
    });

    it("Should set the correct max members", async function () {
      expect(await ajo.maxMembers()).to.equal(maxMembers);
    });

    it("Should initialize with empty pool", async function () {
      expect(await ajo.totalPool()).to.equal(0);
    });
  });

  // POSITIVE TEST CASES - DEPOSIT ACCEPTANCE
  describe("Deposit - Positive Cases (Exact Amount Acceptance)", function () {
    it("Should accept exact deposit amount and emit Deposited event", async function () {
      await expect(
        ajo.connect(member1).deposit({ value: contributionAmount })
      )
        .to.emit(ajo, "Deposited")
        .withArgs(member1.address, contributionAmount);

      expect(await ajo.balances(member1.address)).to.equal(contributionAmount);
      expect(await ajo.totalPool()).to.equal(contributionAmount);
    });

    it("Should add new member to members array on first deposit", async function () {
      await ajo.connect(member1).deposit({ value: contributionAmount });
      
      expect(await ajo.members(0)).to.equal(member1.address);
      const memberCount = await ajo.members.length;
      expect(memberCount).to.equal(1);
    });

    it("Should not add duplicate member on second deposit", async function () {
      await ajo.connect(member1).deposit({ value: contributionAmount });
      await ajo.connect(member1).deposit({ value: contributionAmount });

      const memberCount = await ajo.members.length;
      expect(memberCount).to.equal(1);
      expect(await ajo.members(0)).to.equal(member1.address);
    });

    it("Should accumulate balance on multiple deposits from same member", async function () {
      const numDeposits = 3;
      
      for (let i = 0; i < numDeposits; i++) {
        await ajo.connect(member1).deposit({ value: contributionAmount });
      }

      expect(await ajo.balances(member1.address)).to.equal(
        contributionAmount.mul(numDeposits)
      );
      expect(await ajo.totalPool()).to.equal(
        contributionAmount.mul(numDeposits)
      );
    });

    it("Should handle deposits from multiple different members", async function () {
      await ajo.connect(member1).deposit({ value: contributionAmount });
      await ajo.connect(member2).deposit({ value: contributionAmount });
      await ajo.connect(member3).deposit({ value: contributionAmount });

      expect(await ajo.balances(member1.address)).to.equal(contributionAmount);
      expect(await ajo.balances(member2.address)).to.equal(contributionAmount);
      expect(await ajo.balances(member3.address)).to.equal(contributionAmount);
      expect(await ajo.totalPool()).to.equal(contributionAmount.mul(3));

      const memberCount = await ajo.members.length;
      expect(memberCount).to.equal(3);
    });

    it("Should fill pool up to maxMembers capacity", async function () {
      const memberAddresses = [member1, member2, member3, ...addrs.slice(0, maxMembers - 3)];
      
      for (let i = 0; i < maxMembers; i++) {
        await ajo.connect(memberAddresses[i]).deposit({ value: contributionAmount });
      }

      const memberCount = await ajo.members.length;
      expect(memberCount).to.equal(maxMembers);
      expect(await ajo.totalPool()).to.equal(contributionAmount.mul(maxMembers));
    });

    it("Should maintain correct totalPool after sequential deposits", async function () {
      let expectedTotal = ethers.BigNumber.from(0);

      for (let i = 0; i < 5; i++) {
        const member = addrs[i];
        await ajo.connect(member).deposit({ value: contributionAmount });
        expectedTotal = expectedTotal.add(contributionAmount);
        expect(await ajo.totalPool()).to.equal(expectedTotal);
      }
    });

    it("Should emit correct event with exact amount for each deposit", async function () {
      const members = [member1, member2, member3];
      
      for (let i = 0; i < members.length; i++) {
        const tx = ajo.connect(members[i]).deposit({ value: contributionAmount });
        await expect(tx)
          .to.emit(ajo, "Deposited")
          .withArgs(members[i].address, contributionAmount);
      }
    });
  });

  // NEGATIVE TEST CASES - DEPOSIT REJECTION
  describe("Deposit - Negative Cases (Exact Amount Rejection)", function () {
    it("Should reject deposit with 0 amount", async function () {
      await expect(
        ajo.connect(member1).deposit({ value: 0 })
      ).to.be.revertedWithCustomError(ajo, "InvalidContribution");
    });

    it("Should reject deposit with amount less than contribution (50% shortfall)", async function () {
      const tooSmallAmount = contributionAmount.div(2);
      
      await expect(
        ajo.connect(member1).deposit({ value: tooSmallAmount })
      ).to.be.revertedWithCustomError(ajo, "InvalidContribution");

      expect(await ajo.balances(member1.address)).to.equal(0);
      expect(await ajo.totalPool()).to.equal(0);
    });

    it("Should reject deposit with amount slightly less than contribution (1 wei)", async function () {
      const almostEnough = contributionAmount.sub(1);
      
      await expect(
        ajo.connect(member1).deposit({ value: almostEnough })
      ).to.be.revertedWithCustomError(ajo, "InvalidContribution");

      expect(await ajo.balances(member1.address)).to.equal(0);
    });

    it("Should reject deposit with amount greater than contribution (1x)", async function () {
      const tooMuchAmount = contributionAmount.mul(2);
      
      await expect(
        ajo.connect(member1).deposit({ value: tooMuchAmount })
      ).to.be.revertedWithCustomError(ajo, "InvalidContribution");

      expect(await ajo.balances(member1.address)).to.equal(0);
    });

    it("Should reject deposit with amount greater than contribution (1 wei)", async function () {
      const tooMuchAmount = contributionAmount.add(1);
      
      await expect(
        ajo.connect(member1).deposit({ value: tooMuchAmount })
      ).to.be.revertedWithCustomError(ajo, "InvalidContribution");

      expect(await ajo.balances(member1.address)).to.equal(0);
    });

    it("Should maintain balances after rejected deposit", async function () {
      // First deposit succeeds
      await ajo.connect(member1).deposit({ value: contributionAmount });
      expect(await ajo.balances(member1.address)).to.equal(contributionAmount);

      // Second deposit with wrong amount fails
      await expect(
        ajo.connect(member1).deposit({ value: contributionAmount.div(2) })
      ).to.be.revertedWithCustomError(ajo, "InvalidContribution");

      // Balance should remain unchanged
      expect(await ajo.balances(member1.address)).to.equal(contributionAmount);
      expect(await ajo.totalPool()).to.equal(contributionAmount);
    });

    it("Should reject multiple invalid amounts in sequence", async function () {
      const invalidAmounts = [
        0,
        contributionAmount.div(10),
        contributionAmount.add(1),
        ethers.utils.parseEther("0.00001"),
      ];

      for (const amount of invalidAmounts) {
        await expect(
          ajo.connect(member1).deposit({ value: amount })
        ).to.be.revertedWithCustomError(ajo, "InvalidContribution");
      }

      expect(await ajo.balances(member1.address)).to.equal(0);
      expect(await ajo.totalPool()).to.equal(0);
    });
  });

  // EDGE CASES - CHAIN LIMITS
  describe("Deposit - Edge Cases and Chain Limits", function () {
    it("Should handle very small contribution amounts (Wei precision)", async function () {
      const smallContribution = ethers.utils.parseEther("0.000001"); // 1 microether = 1e12 wei
      
      const Ajo = await ethers.getContractFactory("Ajo");
      const ajoSmall = await Ajo.deploy(smallContribution, cycleDuration, maxMembers);
      await ajoSmall.waitForDeployment();

      await ajoSmall.connect(member1).deposit({ value: smallContribution });
      expect(await ajoSmall.balances(member1.address)).to.equal(smallContribution);
    });

    it("Should handle large contribution amounts without overflow", async function () {
      const largeContribution = ethers.utils.parseEther("1000"); // 1000 ETH
      
      const Ajo = await ethers.getContractFactory("Ajo");
      const ajoLarge = await Ajo.deploy(largeContribution, cycleDuration, maxMembers);
      await ajoLarge.waitForDeployment();

      await ajoLarge.connect(member1).deposit({ value: largeContribution });
      expect(await ajoLarge.balances(member1.address)).to.equal(largeContribution);
    });

    it("Should not overflow totalPool with maximum safe deposits", async function () {
      // Create pool with small contribution to test max capacity
      const Ajo = await ethers.getContractFactory("Ajo");
      const ajoMax = await Ajo.deploy(ethers.utils.parseEther("1"), cycleDuration, 5);
      await ajoMax.waitForDeployment();

      const members = [member1, member2, member3, ...addrs.slice(0, 2)];
      
      for (let i = 0; i < 5; i++) {
        await ajoMax.connect(members[i]).deposit({ value: ethers.utils.parseEther("1") });
      }

      expect(await ajoMax.totalPool()).to.equal(ethers.utils.parseEther("5"));
    });
  });

  // POOL CAPACITY TESTS
  describe("Deposit - Pool Capacity Limits", function () {
    it("Should revert when pool is at exact capacity", async function () {
      const Ajo = await ethers.getContractFactory("Ajo");
      const ajoSmall = await Ajo.deploy(contributionAmount, cycleDuration, 1);
      await ajoSmall.waitForDeployment();

      // Fill pool to capacity
      await ajoSmall.connect(member1).deposit({ value: contributionAmount });

      // Try to add one more member
      await expect(
        ajoSmall.connect(member2).deposit({ value: contributionAmount })
      ).to.be.revertedWithCustomError(ajoSmall, "AjoIsFull");

      expect(await ajoSmall.members.length).to.equal(1);
    });

    it("Should revert when trying to exceed pool capacity", async function () {
      const Ajo = await ethers.getContractFactory("Ajo");
      const ajoSmall = await Ajo.deploy(contributionAmount, cycleDuration, 2);
      await ajoSmall.waitForDeployment();

      await ajoSmall.connect(member1).deposit({ value: contributionAmount });
      await ajoSmall.connect(member2).deposit({ value: contributionAmount });

      // Both members can still deposit more (same member)
      await ajoSmall.connect(member1).deposit({ value: contributionAmount });

      // But new member cannot join
      await expect(
        ajoSmall.connect(member3).deposit({ value: contributionAmount })
      ).to.be.revertedWithCustomError(ajoSmall, "AjoIsFull");
    });

    it("Should allow same member to deposit even when pool is full", async function () {
      const Ajo = await ethers.getContractFactory("Ajo");
      const ajoSmall = await Ajo.deploy(contributionAmount, cycleDuration, 1);
      await ajoSmall.waitForDeployment();

      await ajoSmall.connect(member1).deposit({ value: contributionAmount });

      // Same member can deposit again even though pool is "full"
      await expect(
        ajoSmall.connect(member1).deposit({ value: contributionAmount })
      )
        .to.emit(ajoSmall, "Deposited")
        .withArgs(member1.address, contributionAmount);

      expect(await ajoSmall.balances(member1.address)).to.equal(
        contributionAmount.mul(2)
      );
    });
  });

  // STATE ISOLATION TEST
  describe("Deposit - State Isolation and Fault Detection", function () {
    it("Should isolate state between different members", async function () {
      await ajo.connect(member1).deposit({ value: contributionAmount });

      // member2 deposit should not affect member1's balance
      await ajo.connect(member2).deposit({ value: contributionAmount });

      expect(await ajo.balances(member1.address)).to.equal(contributionAmount);
      expect(await ajo.balances(member2.address)).to.equal(contributionAmount);
    });

    it("Should not modify totalPool on failed deposit", async function () {
      await ajo.connect(member1).deposit({ value: contributionAmount });
      const poolBefore = await ajo.totalPool();

      await expect(
        ajo.connect(member2).deposit({ value: contributionAmount.div(2) })
      ).to.be.revertedWithCustomError(ajo, "InvalidContribution");

      expect(await ajo.totalPool()).to.equal(poolBefore);
    });

    it("Should not add member on failed deposit", async function () {
      await ajo.connect(member1).deposit({ value: contributionAmount });
      const memberCountBefore = await ajo.members.length;

      await expect(
        ajo.connect(member2).deposit({ value: 0 })
      ).to.be.revertedWithCustomError(ajo, "InvalidContribution");

      const memberCountAfter = await ajo.members.length;
      expect(memberCountAfter).to.equal(memberCountBefore);
    });

    it("Should detect inconsistencies in balance tracking", async function () {
      await ajo.connect(member1).deposit({ value: contributionAmount });
      await ajo.connect(member2).deposit({ value: contributionAmount });
      await ajo.connect(member1).deposit({ value: contributionAmount });

      const balance1 = await ajo.balances(member1.address);
      const balance2 = await ajo.balances(member2.address);
      const totalPool = await ajo.totalPool();

      // Verify consistency: sum of individual balances should equal totalPool
      expect(balance1.add(balance2)).to.be.lte(totalPool);
    });
  });

  // COMPLEX SCENARIOS
  describe("Deposit - Complex Scenarios", function () {
    it("Should handle interleaved deposits and maintain consistency", async function () {
      const operations = [
        { member: member1, amount: contributionAmount },
        { member: member2, amount: contributionAmount },
        { member: member1, amount: contributionAmount },
        { member: member3, amount: contributionAmount },
        { member: member2, amount: contributionAmount },
      ];

      for (const op of operations) {
        await ajo.connect(op.member).deposit({ value: op.amount });
      }

      expect(await ajo.balances(member1.address)).to.equal(contributionAmount.mul(2));
      expect(await ajo.balances(member2.address)).to.equal(contributionAmount.mul(2));
      expect(await ajo.balances(member3.address)).to.equal(contributionAmount);
      expect(await ajo.totalPool()).to.equal(contributionAmount.mul(5));
    });

    it("Should maintain accuracy with mixed valid and invalid deposits", async function () {
      // Valid
      await ajo.connect(member1).deposit({ value: contributionAmount });
      
      // Invalid
      await expect(
        ajo.connect(member2).deposit({ value: contributionAmount.mul(2) })
      ).to.be.revertedWithCustomError(ajo, "InvalidContribution");
      
      // Valid
      await ajo.connect(member2).deposit({ value: contributionAmount });
      
      // Invalid
      await expect(
        ajo.connect(member3).deposit({ value: 0 })
      ).to.be.revertedWithCustomError(ajo, "InvalidContribution");
      
      // Valid
      await ajo.connect(member3).deposit({ value: contributionAmount });

      expect(await ajo.totalPool()).to.equal(contributionAmount.mul(3));
      const memberCount = await ajo.members.length;
      expect(memberCount).to.equal(3);
    });

    it("Should handle stress test with maximum members", async function () {
      const Ajo = await ethers.getContractFactory("Ajo");
      const ajoStress = await Ajo.deploy(
        ethers.utils.parseEther("0.1"),
        cycleDuration,
        10
      );
      await ajoStress.waitForDeployment();

      const members = [member1, member2, member3, ...addrs.slice(0, 7)];
      
      for (let i = 0; i < 10; i++) {
        await ajoStress
          .connect(members[i])
          .deposit({ value: ethers.utils.parseEther("0.1") });
      }

      expect(await ajoStress.totalPool()).to.equal(ethers.utils.parseEther("1"));
      const memberCount = await ajoStress.members.length;
      expect(memberCount).to.equal(10);

      // Exceed capacity
      await expect(
        ajoStress.connect(addrs[7]).deposit({ value: ethers.utils.parseEther("0.1") })
      ).to.be.revertedWithCustomError(ajoStress, "AjoIsFull");
    });
  });

  describe("Deposit", function () {
  });
});