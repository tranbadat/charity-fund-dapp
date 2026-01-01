import * as anchor from "@coral-xyz/anchor";
import { CharityFund } from "../target/types/charity_fund";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";

describe("charity_fund", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CharityFund as any;

  const admin = provider.wallet;
  const donor = anchor.web3.Keypair.generate();
  const voter = anchor.web3.Keypair.generate();
  const recipient = anchor.web3.Keypair.generate();
  const refundDonor = anchor.web3.Keypair.generate();

  let campaign: PublicKey;
  let treasury: PublicKey;
  let donation: PublicKey;
  let proposal: PublicKey;

  let refundCampaign: PublicKey;
  let refundTreasury: PublicKey;
  let refundDonation: PublicKey;

  it("Airdrop SOL to donor & voter", async () => {
    for (const kp of [donor, voter, refundDonor]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }
  });

  it("Initialize campaign", async () => {
    const campaignKeypair = anchor.web3.Keypair.generate();
    campaign = campaignKeypair.publicKey;

    [treasury] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), campaign.toBuffer()],
      program.programId
    );

    await program.methods
      .initializeCampaign(
        new anchor.BN(1 * LAMPORTS_PER_SOL),
        new anchor.BN(Math.floor(Date.now() / 1000) + 3600)
      )
      .accounts({
        campaign,
        treasury,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([campaignKeypair])
      .rpc();

    const balance = await provider.connection.getBalance(treasury);
    assert.equal(balance, 0);
  });

  it("Donate to treasury PDA", async () => {
    [donation] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("donation"),
        campaign.toBuffer(),
        donor.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .donate(new anchor.BN(0.5 * LAMPORTS_PER_SOL))
      .accounts({
        campaign,
        donation,
        treasury,
        donor: donor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([donor])
      .rpc();

    const balance = await provider.connection.getBalance(treasury);
    assert.isAbove(balance, 0);
  });

  it("Create proposal (lock recipient)", async () => {
    const identityHash = new Uint8Array(32).fill(1);

    [proposal] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        campaign.toBuffer(),
        admin.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .createProposal(
        recipient.publicKey,
        Array.from(identityHash),
        new anchor.BN(0.5 * LAMPORTS_PER_SOL)
      )
      .accounts({
        proposal,
        campaign,
        proposer: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const proposalAccount =
      await (program.account as any).proposalAccount.fetch(proposal);

    assert.equal(
      proposalAccount.recipientWallet.toBase58(),
      recipient.publicKey.toBase58()
    );
  });

  it("Vote YES", async () => {
    const [voteRecord] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vote"),
        proposal.toBuffer(),
        voter.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .vote(true)
      .accounts({
        proposal,
        voteRecord,
        voter: voter.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([voter])
      .rpc();

    const proposalAccount =
      await (program.account as any).proposalAccount.fetch(proposal);

    assert.equal(proposalAccount.yesVotes.toNumber(), 1);
  });

  it("Execute proposal", async () => {
    const before = await provider.connection.getBalance(
      recipient.publicKey
    );

    await program.methods
      .executeProposal()
      .accounts({
        proposal,
        campaign,
        treasury,
        recipient: recipient.publicKey,
        executor: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const after = await provider.connection.getBalance(
      recipient.publicKey
    );

    assert.isAbove(after, before);

    const proposalAccount =
      await program.account.proposalAccount.fetch(proposal);

    assert.isTrue(proposalAccount.executed);
  });

  it("Refund after expiry when no proposal executed", async () => {
    const refundCampaignKeypair = anchor.web3.Keypair.generate();
    refundCampaign = refundCampaignKeypair.publicKey;

    [refundTreasury] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), refundCampaign.toBuffer()],
      program.programId
    );

    [refundDonation] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("donation"),
        refundCampaign.toBuffer(),
        refundDonor.publicKey.toBuffer(),
      ],
      program.programId
    );

    const shortDeadline = Math.floor(Date.now() / 1000) + 2;

    await program.methods
      .initializeCampaign(
        new anchor.BN(0.5 * LAMPORTS_PER_SOL),
        new anchor.BN(shortDeadline)
      )
      .accounts({
        campaign: refundCampaign,
        treasury: refundTreasury,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([refundCampaignKeypair])
      .rpc();

    await program.methods
      .donate(new anchor.BN(0.25 * LAMPORTS_PER_SOL))
      .accounts({
        campaign: refundCampaign,
        donation: refundDonation,
        treasury: refundTreasury,
        donor: refundDonor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([refundDonor])
      .rpc();

    const balanceBefore = await provider.connection.getBalance(
      refundDonor.publicKey
    );

    await new Promise((resolve) => setTimeout(resolve, 3000));

    await program.methods
      .refund()
      .accounts({
        campaign: refundCampaign,
        treasury: refundTreasury,
        donation: refundDonation,
        donor: refundDonor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([refundDonor])
      .rpc();

    const balanceAfter = await provider.connection.getBalance(
      refundDonor.publicKey
    );

    assert.isAbove(balanceAfter, balanceBefore);
  });
});
