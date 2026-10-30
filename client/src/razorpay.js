let checkoutScript;

function loadCheckout() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (checkoutScript) return checkoutScript;
  checkoutScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay Checkout did not load.'));
    script.onerror = () => reject(new Error('Could not load Razorpay Checkout. Check your internet connection and try again.'));
    document.head.appendChild(script);
  });
  return checkoutScript;
}

export async function openRazorpayCheckout({ checkout, user, onSuccess, onDismiss, onError }) {
  const Razorpay = await loadCheckout();
  const modal = new Razorpay({
    key: checkout.key_id,
    ...(checkout.subscription_id ? { subscription_id: checkout.subscription_id } : { order_id: checkout.order_id, amount: checkout.amount, currency: checkout.currency }),
    name: 'Northstar Athletic Club',
    description: checkout.planName + (checkout.subscription_id ? ' · monthly auto-renew membership' : ' · one month membership'),
    prefill: { name: user?.name || '', email: user?.email || '' },
    theme: { color: '#a8bb71' },
    handler: (response) => onSuccess({
      razorpay_payment_id: response.razorpay_payment_id,
      ...(checkout.subscription_id ? { razorpay_subscription_id: response.razorpay_subscription_id || checkout.subscription_id } : { razorpay_order_id: response.razorpay_order_id || checkout.order_id }),
      razorpay_signature: response.razorpay_signature,
    }),
    modal: { ondismiss: onDismiss },
  });
  modal.on('payment.failed', (event) => onError(new Error(event.error?.description || 'The payment did not go through. Please try again.')));
  modal.open();
}
