import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CharityFund } from "../target/types/charity_fund";
import { SystemProgram, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";

describe("charity_fund", () => {
  // Provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CharityFund as Program<CharityFund>;

  // Actors
  const admin = provider.wallet;
  const donor = anchor.web3.Keypair.generate();
  const voter = anchor.web3.Keypair.generate();
  const recipient = anchor.web3.Keypair.generate();

  // Accounts
  let campaign: PublicKey;
  let treasury: PublicKey;
  let proposal: PublicKey;

  // -----------------------------
  // Airdrop
  // -----------------------------
  it("Airdrop SOL to donor & voter", async () => {
    for (const kp of [donor, voter]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }
  });

  // -----------------------------
  // Init campaign + treasury PDA
  // -----------------------------
  it("Initialize campaign", async () => {
    const campaignKeypair = anchor.web3.Keypair.generate();
    campaign = campaignKeypair.publicKey;

    await program.methods
      .initializeCampaign(new anchor.BN(1 * LAMPORTS_PER_SOL))
      .accounts({
        campaign,
        admin: admin.publicKey,
      })
      .signers([campaignKeypair])
      .rpc();


    // Derive treasury PDA (READ ONLY)
    [treasury] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), campaign.toBuffer()],
      program.programId
    );

    const balance = await provider.connection.getBalance(treasury);
    assert.equal(balance, 0);
  });

  // -----------------------------
  // Donate
  // -----------------------------
  it("Donate to treasury PDA", async () => {
    await program.methods
      .donate(new anchor.BN(0.5 * LAMPORTS_PER_SOL))
      .accounts({
        campaign,
        donor: donor.publicKey,
      })
      .signers([donor])
      .rpc();

    const balance = await provider.connection.getBalance(treasury);
    assert.isAbove(balance, 0);
  });

  // -----------------------------
  // Create proposal
  // -----------------------------
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
        campaign,
        proposer: admin.publicKey,
      })
      .rpc();


    const proposalAccount =
      await program.account.proposalAccount.fetch(proposal);

    assert.equal(
      proposalAccount.recipientWallet.toBase58(),
      recipient.publicKey.toBase58()
    );
  });

  // -----------------------------
  // Vote YES (Vote PDA chống trùng)
  // -----------------------------
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
        voter: voter.publicKey,
      })
      .signers([voter])
      .rpc();

    const proposalAccount =
      await program.account.proposalAccount.fetch(proposal);

    assert.equal(proposalAccount.yesVotes.toNumber(), 1);
  });

  // -----------------------------
  // Execute proposal (invoke_signed)
  // -----------------------------
  it("Execute proposal", async () => {
    const before = await provider.connection.getBalance(
      recipient.publicKey
    );

    await program.methods.executeProposal().accounts({
      proposal,
      campaign,
      recipient: recipient.publicKey,
    }).rpc();


    const after = await provider.connection.getBalance(
      recipient.publicKey
    );

    assert.isAbove(after, before);

    const proposalAccount =
      await program.account.proposalAccount.fetch(proposal);

    assert.isTrue(proposalAccount.executed);
  });
});
