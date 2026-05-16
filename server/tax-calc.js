/**
 * Stupid Simple Tax Refund Estimator
 *
 * Rules (based on common Israeli tax refund scenarios):
 *   - Changed jobs in last 6 years  → ₪1,500
 *   - Was unemployed                → ₪2,000
 *   - Was a student                 → ₪1,200
 *   - Paid medical/dental           → ₪2,500
 *   - Base minimum (if all "no")    → ₪800
 */

function calculateRefund(answers) {
  if (!Array.isArray(answers) || answers.length === 0) {
    return { refund: 0, breakdown: [], totalAdditions: 0 };
  }

  const rules = [
    { id: 'work',          label: 'החלפת עבודה',         amount: 1500, keywords: ['כן'] },
    { id: 'unemployment',  label: 'תקופת אבטלה',         amount: 2000, keywords: ['כן'] },
    { id: 'student',       label: 'לימודים אקדמיים',     amount: 1200, keywords: ['כן'] },
    { id: 'medical',       label: 'הוצאות רפואיות',      amount: 2500, keywords: ['כן'] },
  ];

  const breakdown = [];
  let total = 0;

  for (const rule of rules) {
    const match = answers.find(
      a => a.questionId === rule.id && rule.keywords.includes(a.answer)
    );
    if (match) {
      total += rule.amount;
      breakdown.push({ label: rule.label, amount: rule.amount });
    }
  }

  if (total === 0) {
    total = 800;
    breakdown.push({ label: 'החזר בסיס מינימלי', amount: 800 });
  }

  return { refund: total, breakdown, totalAdditions: total };
}

module.exports = { calculateRefund };
