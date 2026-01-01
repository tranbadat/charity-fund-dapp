use anchor_lang::prelude::*;
use anchor_lang::system_program::{self};

declare_id!("6Aqi76NwBfy2W7qSHgWptjdoTYWHCig63dcCuZUZBeTn");

#[program]
pub mod charity_fund {
    use super::*;

    pub fn initialize_campaign(
        ctx: Context<InitializeCampaign>,
        target_amount: u64,
        deadline: i64,
    ) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;

        campaign.admin = ctx.accounts.admin.key();
        campaign.target_amount = target_amount;
        campaign.total_donated = 0;
        campaign.is_active = true;
        campaign.deadline = deadline;
        campaign.has_executed_proposal = false;

        Ok(())
    }

    pub fn donate(ctx: Context<Donate>, amount: u64) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let donation = &mut ctx.accounts.donation;

        require!(campaign.is_active, CustomError::CampaignInactive);
        require!(
            Clock::get()?.unix_timestamp <= campaign.deadline,
            CustomError::CampaignExpired
        );

        if donation.amount == 0 && donation.campaign == Pubkey::default() {
            donation.campaign = campaign.key();
            donation.donor = ctx.accounts.donor.key();
        } else {
            require_keys_eq!(
                donation.campaign,
                campaign.key(),
                CustomError::InvalidDonationAccount
            );
            require_keys_eq!(
                donation.donor,
                ctx.accounts.donor.key(),
                CustomError::InvalidDonationAccount
            );
        }

        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.donor.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
        );

        system_program::transfer(cpi_ctx, amount)?;
        campaign.total_donated = campaign
            .total_donated
            .checked_add(amount)
            .ok_or(CustomError::ArithmeticOverflow)?;
        donation.amount = donation
            .amount
            .checked_add(amount)
            .ok_or(CustomError::ArithmeticOverflow)?;

        Ok(())
    }

    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        recipient_wallet: Pubkey,
        recipient_identity_hash: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let campaign = &ctx.accounts.campaign;

        require!(campaign.is_active, CustomError::CampaignInactive);
        require!(
            Clock::get()?.unix_timestamp <= campaign.deadline,
            CustomError::CampaignExpired
        );

        proposal.campaign = campaign.key();
        proposal.proposer = ctx.accounts.proposer.key();

        proposal.recipient_wallet = recipient_wallet;
        proposal.recipient_identity_hash = recipient_identity_hash;
        proposal.amount = amount;

        proposal.yes_votes = 0;
        proposal.no_votes = 0;
        proposal.executed = false;

        Ok(())
    }

    pub fn vote(ctx: Context<Vote>, approve: bool) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;

        require!(!proposal.executed, CustomError::ProposalAlreadyExecuted);

        if approve {
            proposal.yes_votes = proposal
                .yes_votes
                .checked_add(1)
                .ok_or(CustomError::ArithmeticOverflow)?;
        } else {
            proposal.no_votes = proposal
                .no_votes
                .checked_add(1)
                .ok_or(CustomError::ArithmeticOverflow)?;
        }

        Ok(())
    }

    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let campaign = &mut ctx.accounts.campaign;

        require!(!proposal.executed, CustomError::ProposalAlreadyExecuted);
        require!(!campaign.has_executed_proposal, CustomError::ProposalAlreadyExecuted);
        require!(campaign.is_active, CustomError::CampaignInactive);
        require!(
            Clock::get()?.unix_timestamp <= campaign.deadline,
            CustomError::CampaignExpired
        );

        require!(
            proposal.yes_votes > proposal.no_votes,
            CustomError::VoteNotPassed
        );

        require_keys_eq!(
            ctx.accounts.recipient.key(),
            proposal.recipient_wallet,
            CustomError::InvalidRecipient
        );

        let campaign_key = campaign.key();

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

        proposal.executed = true;
        campaign.has_executed_proposal = true;
        campaign.is_active = false;

        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let donation = &mut ctx.accounts.donation;

        require!(
            Clock::get()?.unix_timestamp > campaign.deadline,
            CustomError::CampaignNotExpired
        );
        require!(!campaign.has_executed_proposal, CustomError::ProposalAlreadyExecuted);
        require!(
            donation.amount > 0,
            CustomError::NoDonationToRefund
        );
        require_keys_eq!(
            donation.campaign,
            campaign.key(), 
            CustomError::InvalidDonationAccount
        );
        require_keys_eq!(
            donation.donor,
            ctx.accounts.donor.key(),
            CustomError::InvalidDonationAccount
        );
        require!(
            ctx.accounts.treasury.to_account_info().lamports() >= donation.amount,
            CustomError::InsufficientTreasury
        );

        let amount = donation.amount;

        let campaign_key = campaign.key();
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
                to: ctx.accounts.donor.to_account_info(),
            },
            signer_seeds,
        );

        anchor_lang::system_program::transfer(cpi_ctx, amount)?;

        campaign.total_donated = campaign
            .total_donated
            .checked_sub(amount)
            .ok_or(CustomError::ArithmeticOverflow)?;
        donation.amount = 0;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeCampaign<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + CampaignAccount::INIT_SPACE
    )]
    pub campaign: Account<'info, CampaignAccount>,
    

    /// CHECK: Treasury PDA ch ¯% gi ¯_ SOL
    #[account(
        init,
        payer = admin,
        space = 0,
        seeds = [b"treasury", campaign.key().as_ref()],
        bump
    )]
    pub treasury: SystemAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Donate<'info> {
    #[account(mut)]
    pub campaign: Account<'info, CampaignAccount>,

    #[account(
        init_if_needed,
        payer = donor,
        space = 8 + DonationAccount::INIT_SPACE,
        seeds = [
            b"donation",
            campaign.key().as_ref(),
            donor.key().as_ref()
        ],
        bump
    )]
    pub donation: Account<'info, DonationAccount>,

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
        space = 8 + ProposalAccount::INIT_SPACE,
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

    /// Vote PDA ƒ?" m ¯-i voter ch ¯% vote 1 l §n
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

    #[account(mut)]
    pub campaign: Account<'info, CampaignAccount>,

    /// Treasury PDA gi ¯_ SOL (system-owned, khA'ng cA3 data)
    #[account(
        mut,
        seeds = [b"treasury", campaign.key().as_ref()],
        bump
    )]
    pub treasury: SystemAccount<'info>,

    /// CHECK: recipient validated against proposal.recipient
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    /// Signer that authorizes execution (provided by the client)
    pub executor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub campaign: Account<'info, CampaignAccount>,

    #[account(
        mut,
        seeds = [b"treasury", campaign.key().as_ref()],
        bump
    )]
    pub treasury: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [
            b"donation",
            campaign.key().as_ref(),
            donor.key().as_ref()
        ],
        bump,
        close = donor
    )]
    pub donation: Account<'info, DonationAccount>,

    #[account(mut)]
    pub donor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(InitSpace)]
#[account]
pub struct VoteAccount {}

#[derive(InitSpace)]
#[account]
pub struct CampaignAccount {
    pub admin: Pubkey,
    pub target_amount: u64,
    pub total_donated: u64,
    pub deadline: i64,
    pub is_active: bool,
    pub has_executed_proposal: bool,
}

#[derive(InitSpace)]
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

#[derive(InitSpace)]
#[account]
pub struct DonationAccount {
    pub campaign: Pubkey,
    pub donor: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum CustomError {
    #[msg("Campaign is not active")]
    CampaignInactive,
    #[msg("Campaign has expired")]
    CampaignExpired,
    #[msg("Campaign has not expired")]
    CampaignNotExpired,
    #[msg("Proposal already executed")]
    ProposalAlreadyExecuted,
    #[msg("Vote has not passed")]
    VoteNotPassed,
    #[msg("Invalid recipient wallet")]
    InvalidRecipient,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("No donation to refund")]
    NoDonationToRefund,
    #[msg("Invalid donation account")]
    InvalidDonationAccount,
    #[msg("Insufficient treasury funds")]
    InsufficientTreasury,
}
