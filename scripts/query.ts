import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { CharityFund } from "../target/types/charity_fund";
import fs from "fs";
import BN from "bn.js";

/**
 * =========================
 * CONFIG
 * =========================
 */
const RPC_URL = "http://127.0.0.1:8899";

(async () => {
  /**
   * =========================
   * 1. Provider & Wallet
   * =========================
   */
  const connection = new Connection(RPC_URL, "confirmed");

  const home =
    process.platform === "win32"
      ? process.env.USERPROFILE
      : process.env.HOME;

  const keypairPath = `${home}/.config/solana/id.json`;
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, "utf8")))
  );

  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  anchor.setProvider(provider);

  const program = anchor.workspace.CharityFund as Program<CharityFund>;

  /**
   * =========================
   * 2. Authority
   * =========================
   */
  const authority = wallet.publicKey;
  console.log("Authority:", authority.toBase58());

  /**
   * =========================
   * Fetch all campaigns
   * =========================
   */
  const campaigns = await program.account.campaignAccount.all();
  console.log(`Found ${campaigns.length} campaign(s)`);

  if (campaigns.length === 0) {
    console.log("No campaigns found.");
    console.log("\n✅ DONE");
    return;
  }

  for (const c of campaigns) {
    const campaignPubkey = c.publicKey;
    console.log("\n=== CAMPAIGN ===");
    console.log("Campaign PDA:", campaignPubkey.toBase58());
    console.log("Admin:", c.account.admin.toBase58());
    console.log("Target Amount:", Number(c.account.targetAmount) / LAMPORTS_PER_SOL, "SOL");
    console.log("Total Donated:", Number(c.account.totalDonated) / LAMPORTS_PER_SOL, "SOL");
    console.log("Active:", c.account.isActive);

    const [treasuryPda] = PublicKey.findProgramAddressSync([
      Buffer.from("treasury"),
      campaignPubkey.toBuffer(),
    ], program.programId);

    const treasuryBalance = await connection.getBalance(treasuryPda);
    console.log("Treasury:", treasuryPda.toBase58(), `(${treasuryBalance / LAMPORTS_PER_SOL} SOL)`);

    // Fetch proposals for this campaign
    const proposals = await program.account.proposalAccount.all([
      {
        memcmp: {
          offset: 8, // discriminator
          bytes: campaignPubkey.toBase58(),
        },
      },
    ]);

    console.log(`Proposals: ${proposals.length}`);
    for (const p of proposals) {
      console.log("----------------------------");
      console.log("Proposal PDA:", p.publicKey.toBase58());
      console.log("Proposer:", p.account.proposer.toBase58());
      console.log("Recipient:", p.account.recipientWallet.toBase58());
      console.log("Amount:", Number(p.account.amount) / LAMPORTS_PER_SOL, "SOL");
      console.log("Yes:", p.account.yesVotes.toString());
      console.log("No:", p.account.noVotes.toString());
      console.log("Executed:", p.account.executed);
    }
  }
})();
