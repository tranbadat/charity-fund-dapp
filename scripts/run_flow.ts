import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CharityFund } from "../target/types/charity_fund";
import fs from "fs";
import BN from "bn.js";

const RPC_URL = "http://127.0.0.1:8899";

async function airdrop(connection: Connection, pubkey: PublicKey, sol = 2) {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig);
}

async function runOneFlow(program: Program<CharityFund>, connection: Connection, admin: anchor.Wallet) {
  // 1) create campaign keypair and PDAs
  const campaignKeypair = Keypair.generate();
  const campaign = campaignKeypair.publicKey;
  const [treasury] = PublicKey.findProgramAddressSync([Buffer.from("treasury"), campaign.toBuffer()], program.programId);

  console.log("\n=== Running flow for campaign:", campaign.toBase58());

  // 2) initialize campaign
  console.log("Initializing campaign...");
  await program.methods
    .initializeCampaign(new BN(1 * LAMPORTS_PER_SOL))
    .accounts({ campaign, admin: admin.publicKey })
    .signers([campaignKeypair])
    .rpc();

  // 3) donor + voters
  const donor = Keypair.generate();
  const NUM_VOTERS = Number(process.env.NUM_VOTERS || "3");
  const voters: Keypair[] = [];
  await airdrop(connection, donor.publicKey, 2);
  for (let i = 0; i < NUM_VOTERS; i++) {
    const v = Keypair.generate();
    voters.push(v);
    await airdrop(connection, v.publicKey, 2);
  }

  // 4) donate 0.5 SOL
  console.log("Donating 0.5 SOL from donor...");
  await program.methods
    .donate(new BN(0.5 * LAMPORTS_PER_SOL))
    .accounts({ campaign, treasury, donor: donor.publicKey } as any)
    .signers([donor])
    .rpc();

  const treBal = await connection.getBalance(treasury);
  console.log("Treasury balance:", treBal / LAMPORTS_PER_SOL, "SOL");

  // 5) create proposal (admin as proposer)
  const recipient = Keypair.generate();
  const identityHash = new Uint8Array(32).fill(1);
  const [proposal] = PublicKey.findProgramAddressSync([
    Buffer.from("proposal"),
    campaign.toBuffer(),
    admin.publicKey.toBuffer(),
  ], program.programId);

  console.log("Creating proposal...");
  await program.methods
    .createProposal(recipient.publicKey, Array.from(identityHash), new BN(0.5 * LAMPORTS_PER_SOL))
    .accounts({ proposal, campaign, proposer: admin.publicKey } as any)
    .rpc();

  // 6) multiple voters vote YES
  console.log("Voting YES from voters...");
  for (const v of voters) {
    const [voteRecord] = PublicKey.findProgramAddressSync([
      Buffer.from("vote"),
      proposal.toBuffer(),
      v.publicKey.toBuffer(),
    ], program.programId);

    await program.methods
      .vote(true)
      .accounts({ proposal, voteRecord, voter: v.publicKey } as any)
      .signers([v])
      .rpc();
  }

  // 7) execute proposal
  console.log("Executing proposal...");
  const before = await connection.getBalance(recipient.publicKey);

  await program.methods
    .executeProposal()
    .accounts({ proposal, campaign, treasury, recipient: recipient.publicKey } as any)
    .rpc();

  const after = await connection.getBalance(recipient.publicKey);
  console.log("Recipient balance increased:", after > before);
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  const home = process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME;
  const keypairPath = `${home}/.config/solana/id.json`;
  const walletKeypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));
  const wallet = new anchor.Wallet(walletKeypair);

  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.CharityFund as Program<CharityFund>;

  const N = Number(process.env.NUM_CAMPAIGNS || "1");
  for (let i = 0; i < N; i++) {
    await runOneFlow(program, connection, wallet);
  }

  console.log("\nAll done");
}

main().catch((err) => { console.error(err); process.exit(1); });
