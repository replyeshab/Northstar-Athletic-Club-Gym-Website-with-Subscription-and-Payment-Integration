export const plans = [
  { id: 'essential', name: 'Essential', price: 49, currency: 'INR', interval: 'month', description: 'A strong place to start.', features: ['Open gym, any day', '2 group classes / month', 'Locker + towel service', 'Member community'], featured: false },
  { id: 'all-access', name: 'All Access', price: 89, currency: 'INR', interval: 'month', description: 'Your whole training world.', features: ['Everything in Essential', 'Unlimited group classes', 'Sauna + recovery suite', '1 personal training session'], featured: true },
  { id: 'founders', name: 'Founders', price: 149, currency: 'INR', interval: 'month', description: 'Personal support, built in.', features: ['Everything in All Access', 'Weekly coach check-ins', 'Priority class booking', 'Monthly progress review'], featured: false },
];
export const findPlan = (id) => plans.find((plan) => plan.id === id);
