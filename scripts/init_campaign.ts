import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CharityFund } from "../target/types/charity_fund";
import fs from "fs";
import BN from "bn.js";

const RPC_URL = "http://127.0.0.1:8899";

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  const home = process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME;
  const keypairPath = `${home}/.config/solana/id.json`;
  const walletKeypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));

  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.CharityFund as Program<CharityFund>;

  // create N dummy campaigns
  const N = Number(process.env.NUM_CAMPAIGNS || "1");
  for (let i = 0; i < N; i++) {
    const campaignKeypair = Keypair.generate();
    const campaign = campaignKeypair.publicKey;

    const [treasury] = PublicKey.findProgramAddressSync([Buffer.from("treasury"), campaign.toBuffer()], program.programId);

    console.log(`Initializing dummy campaign ${i + 1}/${N}`);

    try {
      await program.account.campaignAccount.fetch(campaign);
      console.log(`  Campaign ${campaign.toBase58()} already exists`);
      continue;
    } catch {
      // proceed to init
    }

    await program.methods
      .initializeCampaign(new BN(1 * LAMPORTS_PER_SOL))
      .accounts({
        campaign,
        admin: wallet.publicKey,
      })
      .signers([campaignKeypair])
      .rpc();

    console.log(`  Created campaign: ${campaign.toBase58()}`);
    console.log(`  Treasury PDA: ${treasury.toBase58()}`);
  }
}

main().then(() => console.log("Done")).catch((err) => { console.error(err); process.exit(1); });
