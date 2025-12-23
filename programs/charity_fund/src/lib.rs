use anchor_lang::prelude::*;
use anchor_lang::system_program::{self};


declare_id!("6Aqi76NwBfy2W7qSHgWptjdoTYWHCig63dcCuZUZBeTn");

#[program]
pub mod charity_fund {
    use super::*;

    // 1️⃣ Khởi tạo campaign + treasury
    pub fn initialize_campaign(
        ctx: Context<InitializeCampaign>,
        target_amount: u64,
    ) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;

        campaign.admin = ctx.accounts.admin.key();
        campaign.target_amount = target_amount;
        campaign.total_donated = 0;
        campaign.is_active = true;

        Ok(())
    }

    // 2️⃣ Donate SOL vào Treasury PDA
    pub fn donate(
        ctx: Context<Donate>,
        amount: u64,
    ) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;

        require!(campaign.is_active, CustomError::CampaignInactive);

        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.donor.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
        );

        system_program::transfer(cpi_ctx, amount)?;
        campaign.total_donated += amount;

        Ok(())
    }

    // 3️⃣ Create proposal – KHÓA recipient
    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        recipient_wallet: Pubkey,
        recipient_identity_hash: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;

        proposal.campaign = ctx.accounts.campaign.key();
        proposal.proposer = ctx.accounts.proposer.key();

        // 🔒 khóa on-chain
        proposal.recipient_wallet = recipient_wallet;
        proposal.recipient_identity_hash = recipient_identity_hash;
        proposal.amount = amount;

        proposal.yes_votes = 0;
        proposal.no_votes = 0;
        proposal.executed = false;

        Ok(())
    }

    pub fn vote(
        ctx: Context<Vote>,
        approve: bool,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;

        require!(!proposal.executed, CustomError::ProposalAlreadyExecuted);

        if approve {
            proposal.yes_votes += 1;
        } else {
            proposal.no_votes += 1;
        }

        Ok(())
    }

    pub fn execute_proposal(
    ctx: Context<ExecuteProposal>,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;

        // 1️⃣ Chưa execute lần nào
        require!(!proposal.executed, CustomError::ProposalAlreadyExecuted);

        // 2️⃣ Điều kiện vote (đơn giản)
        require!(
            proposal.yes_votes > proposal.no_votes,
            CustomError::VoteNotPassed
        );

        // 3️⃣ Kiểm tra đúng recipient
        require_keys_eq!(
            ctx.accounts.recipient.key(),
            proposal.recipient_wallet,
            CustomError::InvalidRecipient
        );

        // 4️⃣ Chuyển SOL từ Treasury PDA → recipient
        let campaign_key = ctx.accounts.campaign.key();

        let seeds = &[
            b"treasury",
            campaign_key.as_ref(),
            &[ctx.bumps.treasury],
        ];

        let signer_seeds = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.treasury.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
            },
            signer_seeds,
        );

        anchor_lang::system_program::transfer(cpi_ctx, proposal.amount)?;

        // 5️⃣ Đánh dấu đã execute
        proposal.executed = true;

        Ok(())
    }

}

#[derive(Accounts)]
pub struct InitializeCampaign<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + CampaignAccount::LEN
    )]
    pub campaign: Account<'info, CampaignAccount>,

    /// CHECK: Treasury PDA chỉ giữ SOL
    #[account(
        init,
        payer = admin,
        seeds = [b"treasury", campaign.key().as_ref()],
        bump,
        space = 8
    )]
    pub treasury: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
pub struct Donate<'info> {
    #[account(mut)]
    pub campaign: Account<'info, CampaignAccount>,

    /// CHECK: Treasury PDA
    #[account(
        mut,
        seeds = [b"treasury", campaign.key().as_ref()],
        bump
    )]
    pub treasury: UncheckedAccount<'info>,

    #[account(mut)]
    pub donor: Signer<'info>,

    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
pub struct CreateProposal<'info> {
    #[account(
        init,
        payer = proposer,
        space = 8 + ProposalAccount::LEN,
        seeds = [
            b"proposal",
            campaign.key().as_ref(),
            proposer.key().as_ref()
        ],
        bump
    )]
    pub proposal: Account<'info, ProposalAccount>,

    pub campaign: Account<'info, CampaignAccount>,

    #[account(mut)]
    pub proposer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut)]
    pub proposal: Account<'info, ProposalAccount>,

    /// Vote PDA – mỗi voter chỉ vote 1 lần
    #[account(
        init,
        payer = voter,
        space = 8,
        seeds = [
            b"vote",
            proposal.key().as_ref(),
            voter.key().as_ref()
        ],
        bump
    )]
    pub vote_record: Account<'info, VoteAccount>,

    #[account(mut)]
    pub voter: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(mut)]
    pub proposal: Account<'info, ProposalAccount>,

    pub campaign: Account<'info, CampaignAccount>,

    /// Treasury PDA giữ SOL (system-owned, không có data)
    #[account(
        mut,
        seeds = [b"treasury", campaign.key().as_ref()],
        bump
    )]
    pub treasury: SystemAccount<'info>,

    /// CHECK: recipient validated against proposal.recipient
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}


#[account]
pub struct VoteAccount {}

#[account]
pub struct CampaignAccount {
    pub admin: Pubkey,
    pub target_amount: u64,
    pub total_donated: u64,
    pub is_active: bool,
}

impl CampaignAccount {
    pub const LEN: usize =
        32 + // admin
        8 +  // target
        8 +  // donated
        1;   // active
}

#[account]
pub struct ProposalAccount {
    pub campaign: Pubkey,
    pub proposer: Pubkey,
    pub recipient_wallet: Pubkey,
    pub recipient_identity_hash: [u8; 32],
    pub amount: u64,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub executed: bool,
}

impl ProposalAccount {
    pub const LEN: usize =
        32 + // campaign
        32 + // proposer
        32 + // recipient_wallet
        32 + // identity hash
        8 +  // amount
        8 +  // yes
        8 +  // no
        1;   // executed
}

#[error_code]
pub enum CustomError {
    #[msg("Campaign is not active")]
    CampaignInactive,
    #[msg("Proposal already executed")]
    ProposalAlreadyExecuted,
    #[msg("Vote has not passed")]
    VoteNotPassed,
    #[msg("Invalid recipient wallet")]
    InvalidRecipient,

}
