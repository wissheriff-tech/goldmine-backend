const { nslToUsdt, round } = require('./currencyConversion');

const VIP_PRODUCT_PLANS = [
  {
    name: 'VIP0',
    price_NSL: 200,
    daily_income_NSL: 1,
    description: 'Starter package for testing the platform with a low entry amount.',
    benefits: ['Daily income tracking', 'Transaction history access', 'Standard support'],
  },
  {
    name: 'VIP1',
    price_NSL: 500,
    daily_income_NSL: 2.75,
    description: 'Basic VIP package for new users building a small balance.',
    benefits: ['VIP0 benefits', 'Basic analytics', 'Standard recharge review'],
  },
  {
    name: 'VIP2',
    price_NSL: 1000,
    daily_income_NSL: 6,
    description: 'Growing package with steady daily NSL credits.',
    benefits: ['VIP1 benefits', 'Faster support review', 'Daily earnings history'],
  },
  {
    name: 'VIP3',
    price_NSL: 2000,
    daily_income_NSL: 13,
    description: 'Premium package for users who want a stronger daily credit.',
    benefits: ['VIP2 benefits', 'Priority support queue', 'Improved account visibility'],
  },
  {
    name: 'VIP4',
    price_NSL: 5000,
    daily_income_NSL: 35,
    description: 'Elite package with higher daily earning capacity.',
    benefits: ['VIP3 benefits', 'Priority recharge approval', 'Extended product access'],
  },
  {
    name: 'VIP5',
    price_NSL: 10000,
    daily_income_NSL: 75,
    description: 'Platinum package for committed users.',
    benefits: ['VIP4 benefits', 'Priority withdrawal review', 'Account performance summary'],
  },
  {
    name: 'VIP6',
    price_NSL: 20000,
    daily_income_NSL: 160,
    description: 'Diamond package with stronger business limits.',
    benefits: ['VIP5 benefits', 'Senior support review', 'Early product notices'],
  },
  {
    name: 'VIP7',
    price_NSL: 50000,
    daily_income_NSL: 425,
    description: 'Royal package for high-volume users.',
    benefits: ['VIP6 benefits', 'High-priority service queue', 'Dedicated finance review'],
  },
  {
    name: 'VIP8',
    price_NSL: 100000,
    daily_income_NSL: 900,
    description: 'Ultimate package for advanced account activity.',
    benefits: ['VIP7 benefits', 'Enhanced account monitoring', 'Premium support channel'],
  },
  {
    name: 'VIP9',
    price_NSL: 200000,
    daily_income_NSL: 1900,
    description: 'Legend package for the highest platform tier.',
    benefits: ['VIP8 benefits', 'Top-priority review', 'Highest platform limits'],
  },
];

const VIP_LEVELS = ['VIP0', 'VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9'];

function planToProductSeed(plan, rate, validityDays = 7) {
  return {
    name: plan.name,
    description: plan.description,
    price_NSL: plan.price_NSL,
    price_usdt: nslToUsdt(plan.price_NSL, rate),
    daily_income_NSL: plan.daily_income_NSL,
    validity_days: validityDays,
    benefits: plan.benefits,
    active: true,
  };
}

function buildPlanBusinessSummary(plan, { rate, days, rechargeFeePct, withdrawalFeePct, referralPcts = [] }) {
  const referralPctTotal = round(referralPcts
    .map((pct) => Number(pct) || 0)
    .reduce((sum, pct) => sum + pct, 0));
  const depositMultiplier = Math.max(0.0001, 1 - Number(rechargeFeePct || 0) / 100);
  const requiredDepositNSL = round(plan.price_NSL / depositMultiplier);
  const depositFeeNSL = round(requiredDepositNSL - plan.price_NSL);
  const totalRewardNSL = round(plan.daily_income_NSL * days);
  const withdrawalFeeNSL = round(totalRewardNSL * Number(withdrawalFeePct || 0) / 100);
  const userNetRewardNSL = round(totalRewardNSL - withdrawalFeeNSL);
  const planMarginNSL = round(plan.price_NSL - totalRewardNSL);
  const grossCompanyBenefitNSL = round(planMarginNSL + depositFeeNSL + withdrawalFeeNSL);
  const depositReferralCommissionNSL = round(requiredDepositNSL * referralPctTotal / 100);
  const purchaseReferralCommissionNSL = round(plan.price_NSL * referralPctTotal / 100);
  const totalReferralCommissionNSL = round(depositReferralCommissionNSL + purchaseReferralCommissionNSL);
  const companyNetBenefitNSL = round(grossCompanyBenefitNSL - totalReferralCommissionNSL);

  return {
    name: plan.name,
    days,
    price_NSL: plan.price_NSL,
    price_usdt: nslToUsdt(plan.price_NSL, rate),
    daily_income_NSL: plan.daily_income_NSL,
    daily_income_usdt: nslToUsdt(plan.daily_income_NSL, rate),
    required_deposit_NSL: requiredDepositNSL,
    required_deposit_usdt: nslToUsdt(requiredDepositNSL, rate),
    deposit_fee_NSL: depositFeeNSL,
    total_reward_NSL: totalRewardNSL,
    total_reward_usdt: nslToUsdt(totalRewardNSL, rate),
    withdrawal_fee_on_reward_NSL: withdrawalFeeNSL,
    user_net_reward_after_withdrawal_NSL: userNetRewardNSL,
    company_plan_margin_NSL: planMarginNSL,
    company_gross_benefit_before_referrals_NSL: grossCompanyBenefitNSL,
    referral_total_pct: referralPctTotal,
    estimated_deposit_referral_commission_NSL: depositReferralCommissionNSL,
    estimated_purchase_referral_commission_NSL: purchaseReferralCommissionNSL,
    estimated_total_referral_commission_NSL: totalReferralCommissionNSL,
    assumes_full_three_level_referral_chain: referralPctTotal > 0,
    company_total_benefit_NSL: companyNetBenefitNSL,
    company_net_profit_NSL: companyNetBenefitNSL,
    company_total_benefit_usdt: nslToUsdt(companyNetBenefitNSL, rate),
    company_net_profit_usdt: nslToUsdt(companyNetBenefitNSL, rate),
  };
}

function buildVipBusinessSummary(settings, rate) {
  const durations = {
    short: Number(settings.dur_short) || 3,
    week: Number(settings.dur_week) || 7,
    month: Number(settings.dur_month) || 30,
    promo: Number(settings.dur_promo) || 14,
  };

  return {
    exchange_rate_nsl_per_usdt: rate,
    fees: {
      recharge_fee_pct: Number(settings.recharge_fee_pct) || 0,
      withdrawal_fee_pct: Number(settings.withdrawal_fee_pct) || 0,
    },
    referral: {
      l1_pct: Number(settings.referral_l1_pct) || 0,
      l2_pct: Number(settings.referral_l2_pct) || 0,
      l3_pct: Number(settings.referral_l3_pct) || 0,
    },
    durations,
    plans: VIP_PRODUCT_PLANS.map(plan => ({
      ...plan,
      by_duration: {
        short: buildPlanBusinessSummary(plan, { rate, days: durations.short, rechargeFeePct: settings.recharge_fee_pct, withdrawalFeePct: settings.withdrawal_fee_pct, referralPcts: [settings.referral_l1_pct, settings.referral_l2_pct, settings.referral_l3_pct] }),
        week: buildPlanBusinessSummary(plan, { rate, days: durations.week, rechargeFeePct: settings.recharge_fee_pct, withdrawalFeePct: settings.withdrawal_fee_pct, referralPcts: [settings.referral_l1_pct, settings.referral_l2_pct, settings.referral_l3_pct] }),
        month: buildPlanBusinessSummary(plan, { rate, days: durations.month, rechargeFeePct: settings.recharge_fee_pct, withdrawalFeePct: settings.withdrawal_fee_pct, referralPcts: [settings.referral_l1_pct, settings.referral_l2_pct, settings.referral_l3_pct] }),
        promo: buildPlanBusinessSummary(plan, { rate, days: durations.promo, rechargeFeePct: settings.recharge_fee_pct, withdrawalFeePct: settings.withdrawal_fee_pct, referralPcts: [settings.referral_l1_pct, settings.referral_l2_pct, settings.referral_l3_pct] }),
      },
    })),
  };
}

module.exports = {
  VIP_LEVELS,
  VIP_PRODUCT_PLANS,
  planToProductSeed,
  buildVipBusinessSummary,
};
