/**
 * Tax Refund Estimator – Wizard Flow
 *
 * Questions:
 *   Step 2 – Employment status  → base amount
 *   Step 3 – Job changes        → addition
 *   Step 4 – Pensya / insurance → addition
 */

function calculateRefund(answers) {
  if (!Array.isArray(answers) || answers.length === 0) {
    return { refund: 0, breakdown: [], totalAdditions: 0 };
  }

  // Employment status base
  const employmentBases = {
    'שכיר': 600,
    'עצמאי': 2200,
    'גם וגם': 2800,
    'חייל משוחרר (ב-3 השנים האחרונות)': 400,
  };
  const empAns = answers.find(a => a.questionId === 'employment');
  const base = empAns ? (employmentBases[empAns.answer] || 0) : 0;

  // Additions
  const rules = [
    { id: 'job_changes', val: 'כן', amount: 1800, label: 'שינויים תעסוקתיים' },
    { id: 'pensya',      val: 'בטוח שיש לי',       amount: 2200, label: 'קרנות השתלמות וביטוחים' },
    { id: 'pensya',      val: 'לא בטוח, תבדקו לי',       amount: 1000, label: 'קרנות השתלמות — נדרשת בדיקה' },
  ];

  const breakdown = [];
  let additions = 0;

  for (const r of rules) {
    if (answers.find(a => a.questionId === r.id && a.answer === r.val)) {
      additions += r.amount;
      breakdown.push({ label: r.label, amount: r.amount });
    }
  }

  let total = base + additions;
  if (base > 0) breakdown.unshift({ label: 'בסיס תעסוקתי', amount: base });

  if (total === 0) {
    total = 800;
    breakdown.push({ label: 'החזר בסיס מינימלי', amount: 800 });
  }

  return { refund: total, breakdown, totalAdditions: total };
}

module.exports = { calculateRefund };
