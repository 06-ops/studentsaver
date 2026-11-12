// Works out how much a student can spend today.
// Own limit: compared with everything spent today.
// From the monthly budget: what is left of the budget, spread over the days left, compared with today's spending in budgeted categories.
export function dailyPlan({ budgets, monthBudgeted, todayBudgeted, todayAll, dailyLimit, now = new Date() }) {
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
  if (dailyLimit > 0) return { allowance: dailyLimit, spent: todayAll, left: dailyLimit - todayAll, source: 'own', daysLeft };
  const total = Object.values(budgets).reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  const before = monthBudgeted - todayBudgeted;
  const allowance = Math.max(0, (total - before) / daysLeft);
  return { allowance, spent: todayBudgeted, left: allowance - todayBudgeted, source: 'budget', daysLeft };
}
