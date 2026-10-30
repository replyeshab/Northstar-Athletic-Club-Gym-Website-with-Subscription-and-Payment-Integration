import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Bell, Check, ChevronRight, Clock3, Dumbbell, Heart, Menu, MoveUpRight, Star, X } from 'lucide-react';
import { api, formatDate, formatMoney, formatTime, post } from '../api';
import { useAuth } from '../auth';
import { openRazorpayCheckout } from '../razorpay';

const fallbackPlans = [
  { id: 'essential', name: 'Essential', price: 49, currency: 'INR', description: 'A strong place to start.', features: ['Open gym, any day', '2 group classes / month', 'Locker + towel service', 'Member community'] },
  { id: 'all-access', name: 'All Access', price: 89, currency: 'USD', description: 'Your whole training world.', features: ['Everything in Essential', 'Unlimited group classes', 'Sauna + recovery suite', '1 personal training session'], featured: true },
  { id: 'founders', name: 'Founders', price: 149, currency: 'USD', description: 'Personal support, built in.', features: ['Everything in All Access', 'Weekly coach check-ins', 'Priority class booking', 'Monthly progress review'] },
];

const reveal = { hidden: { opacity: 0, y: 26 }, show: { opacity: 1, y: 0, transition: { duration: .65, ease: [0.22, 1, 0.36, 1] } } };

export default function HomePage({ onAuthRequest }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sessions, setSessions] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [plans, setPlans] = useState(fallbackPlans);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [unread, setUnread] = useState(0);
  const [flash, setFlash] = useState('');
  const [busyPlan, setBusyPlan] = useState('');
  const [scheduleLoading, setScheduleLoading] = useState(true);

  useEffect(() => {
    api('/sessions').then((result) => setSessions(result.data || [])).catch(() => setSessions([])).finally(() => setScheduleLoading(false));
    api('/reviews').then((result) => setReviews(result.data || [])).catch(() => {});
    api('/plans').then((result) => setPlans(result.data || fallbackPlans)).catch(() => {});
  }, []);

  useEffect(() => {
    if (user) api('/notifications').then((result) => setUnread(result.unread || 0)).catch(() => setUnread(0));
    else setUnread(0);
  }, [user]);

  useEffect(() => {
    if (location.state?.signIn) {
      onAuthRequest('login');
      navigate('/', { replace: true, state: null });
    }
  }, [location.state]);

  async function startCheckout(planId) {
    setBusyPlan(planId);
    try {
      const account = await api('/profile');
      if (account.data.membership && ['active', 'trialing', 'past_due'].includes(account.data.membership.status)) {
        navigate('/member?tab=membership');
        return;
      }
      const result = await post('/create-order', { planId });
      await openRazorpayCheckout({
        checkout: result.data,
        user,
        onSuccess: async (payment) => {
          try {
            await post('/verify-payment', payment);
            navigate('/member?checkout=success');
          } catch (error) { setFlash(error.message); }
          finally { setBusyPlan(''); }
        },
        onDismiss: () => setBusyPlan(''),
        onError: (error) => { setFlash(error.message); setBusyPlan(''); },
      });
    } catch (error) {
      setFlash(error.message);
      setBusyPlan('');
    }
  }

  function choosePlan(planId) {
    if (!user) {
      onAuthRequest('signup', () => startCheckout(planId));
      return;
    }
    startCheckout(planId);
  }

  function bookSession() {
    if (user) navigate('/member?tab=classes');
    else onAuthRequest('signup', () => navigate('/member?tab=classes'));
  }

  return <div className="site-shell">
    {flash && <div className="toast" role="status"><span>{flash}</span><button aria-label="Dismiss" onClick={() => setFlash('')}><X size={16} /></button></div>}
    <header className="site-header">
      <Link to="/" className="wordmark" aria-label="Northstar home"><span className="brand-mark">N</span><span>NORTHSTAR<small>ATHLETIC CLUB</small></span></Link>
      <nav className={mobileMenu ? 'main-nav open' : 'main-nav'}>
        <a href="#approach" onClick={() => setMobileMenu(false)}>Our approach</a>
        <a href="#classes" onClick={() => setMobileMenu(false)}>Classes</a>
        <a href="#plans" onClick={() => setMobileMenu(false)}>Membership</a>
        <a href="#studio" onClick={() => setMobileMenu(false)}>The studio</a>
      </nav>
      <div className="header-actions">
        {user ? <>
          <button className="icon-button notification-button" aria-label={unread ? unread + ' unread notifications' : 'Notifications'} onClick={() => navigate('/member?tab=notifications')}><Bell size={19} />{unread > 0 && <i className="notification-dot" />}</button>
          <Link className="header-member" to={user.role === 'admin' ? '/admin' : '/member'}><span className="avatar-dot">{(user.name || 'N')[0]}</span><span className="header-member-text">My club</span><ArrowUpRight size={15} /></Link>
        </> : <>
          <button className="text-button desktop-signin" onClick={() => onAuthRequest('login')}>Sign in</button>
          <button className="button button-dark button-small" onClick={() => onAuthRequest('signup')}>Join the club <ArrowUpRight size={15} /></button>
        </>}
      </div>
      <button className="mobile-menu-toggle icon-button" onClick={() => setMobileMenu(!mobileMenu)} aria-label={mobileMenu ? 'Close menu' : 'Open menu'}>{mobileMenu ? <X /> : <Menu />}</button>
    </header>

    <main>
      <section className="hero">
        <div className="hero-photo" aria-hidden="true" />
        <div className="hero-grain" aria-hidden="true" />
        <div className="hero-content">
          <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: .1 } } }}>
            <motion.p variants={reveal} className="eyebrow hero-eyebrow"><span className="eyebrow-line" /> TRAIN WITH INTENTION. LIVE WITH MORE.</motion.p>
            <motion.h1 variants={reveal}>Find your<br /><em>strong.</em></motion.h1>
            <motion.p variants={reveal} className="hero-copy">A neighborhood club for people who want to feel better in their bodies, one good day at a time.</motion.p>
            <motion.div variants={reveal} className="hero-actions">
              <a className="button button-lime" href="#plans">Find your membership <ArrowUpRight size={17} /></a>
              <button className="button button-ghost" onClick={bookSession}><span className="play-mark">↗</span> Explore classes</button>
            </motion.div>
            <motion.div variants={reveal} className="hero-footnote"><span className="status-pulse" /> NOW OPEN · EST. 2014 <span className="footnote-divider">/</span> 06:00 — 22:00 DAILY</motion.div>
          </motion.div>
          <motion.div className="hero-side-note" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .65 }}>41° 52' N<br />87° 38' W <span>CHICAGO, IL</span></motion.div>
          <motion.div className="hero-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .55 }}>
            <div className="hero-card-icon"><Dumbbell size={17} /></div><div><strong>Space to show up</strong><span>Whether it's day one or day 1,000.</span></div><ArrowUpRight size={16} />
          </motion.div>
          <a className="hero-scroll" href="#approach"><span>SCROLL TO EXPLORE</span><ArrowDownRight size={16} /></a>
        </div>
        <div className="hero-index">01 <span>/</span> 04</div>
      </section>

      <section className="intro-strip">
        <div className="intro-label"><span className="eyebrow">MORE THAN A WORKOUT</span><span className="intro-arrow"><ArrowDownRight size={17} /></span></div>
        <p>Movement is for <em>every body.</em><br />Let's make it feel like yours.</p>
        <div className="intro-aside">Good coaching. Thoughtful spaces.<br />A little more room to be human.</div>
      </section>

      <section className="approach-section section-pad" id="approach">
        <div className="section-topline"><span className="eyebrow">01 — THE NORTHSTAR WAY</span><span className="section-note">A better relationship with your body, built one visit at a time.</span></div>
        <div className="approach-grid">
          <motion.div className="approach-heading" initial="hidden" whileInView="show" viewport={{ once: true, amount: .25 }} variants={reveal}>
            <h2>Strong is<br /><em>personal.</em></h2>
            <p>We built the kind of gym we wanted to go to: expert-led, never intimidating, and full of people rooting for you.</p>
            <a className="arrow-link" href="#studio">A little about us <ArrowUpRight size={15} /></a>
          </motion.div>
          <div className="approach-visual">
            <img src="https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1100&q=85" alt="Sunlight across the Northstar training floor" loading="lazy" />
            <div className="visual-caption"><span>YOUR SPACE, YOUR PACE.</span><span>01 / 03</span></div>
            <div className="visual-sticker"><span>GOOD<br />THINGS<br />TAKE<br />PRACTICE</span><span className="sticker-star">✳</span></div>
          </div>
        </div>
        <div className="values-row">
          <div><span className="value-number">01</span><h3>Coaching, not shouting.</h3><p>Good coaches meet you where you are, then help you find a little more.</p></div>
          <div><span className="value-number">02</span><h3>Progress without pressure.</h3><p>We celebrate consistency, curiosity, and the days you came anyway.</p></div>
          <div><span className="value-number">03</span><h3>Room for everyone.</h3><p>Beginner-friendly doesn't mean beginner-only. All bodies belong here.</p></div>
        </div>
      </section>

      <section className="class-section section-pad" id="classes">
        <div className="section-topline"><span className="eyebrow">02 — MOVE YOUR WAY</span><a className="arrow-link" href="#classes" onClick={(e) => { e.preventDefault(); bookSession(); }}>VIEW FULL SCHEDULE <ArrowUpRight size={15} /></a></div>
        <div className="class-heading-row"><h2>Find your<br /><em>kind of hard.</em></h2><p>Come for the energy, stay for how good you feel afterwards. Small classes, seriously good coaches.</p></div>
        <div className="class-types">
          <div className="class-type class-type-photo strength"><div className="class-type-top"><span>01 / STRENGTH</span><ArrowUpRight size={18} /></div><div><h3>Lift with<br />intention.</h3><p>Build a base that carries you everywhere.</p></div></div>
          <div className="class-type class-type-photo ride"><div className="class-type-top"><span>02 / RIDE</span><ArrowUpRight size={18} /></div><div><h3>Find your<br />rhythm.</h3><p>Let the music do a little of the work.</p></div></div>
          <div className="class-type class-type-photo flow"><div className="class-type-top"><span>03 / MOBILITY</span><ArrowUpRight size={18} /></div><div><h3>Make room<br />to breathe.</h3><p>Move slower. Leave feeling lighter.</p></div></div>
        </div>

        <div className="schedule-preview">
          <div className="schedule-head"><div><span className="eyebrow">ON THE MAT THIS WEEK</span><h3>Good things are<br /><em>on the calendar.</em></h3></div><button className="button button-outline" onClick={bookSession}>See all classes <ArrowUpRight size={16} /></button></div>
          {sessions.length ? <div className="schedule-list">
            {sessions.slice(0, 4).map((item, index) => <div className="schedule-row" key={item._id || index}>
              <div className="schedule-date"><b>{formatDate(item.date, { weekday: 'short' }).toUpperCase()}</b><span>{formatDate(item.date, { month: 'short', day: 'numeric' })}</span></div>
              <div className="schedule-class"><span className="class-category">{item.category}</span><strong>{item.title}</strong><small>{item.coach} · {item.room}</small></div>
              <div className="schedule-duration"><Clock3 size={15} /> {formatTime(item.date)} <span>·</span> {item.duration} min</div>
              <button className="schedule-action" onClick={bookSession} aria-label={'Book ' + item.title}><ArrowUpRight size={17} /></button>
            </div>)}
          </div> : <div className="schedule-empty">{scheduleLoading ? <><div className="loading-orbit" />Opening the schedule…</> : 'The schedule is getting a refresh. Check back in a little while.'}</div>}
        </div>
      </section>

      <section className="studio-section" id="studio">
        <div className="studio-image"><img src="https://images.unsplash.com/photo-1571902943202-507ec2618e8f?auto=format&fit=crop&w=1600&q=85" alt="Warm, light-filled strength training studio" loading="lazy" /><span className="studio-image-label">THE CLUB / FLOOR 01</span></div>
        <div className="studio-copy">
          <span className="eyebrow">03 — BUILT FOR THE WHOLE YOU</span>
          <h2>Come as<br />you are.<br /><em>Leave more.</em></h2>
          <p>Open floor plans, equipment that feels good to use, and a recovery room for when your body asks for a softer landing.</p>
          <div className="studio-amenities"><span><Check size={14} /> Sauna & cold rinse</span><span><Check size={14} /> Towel service</span><span><Check size={14} /> Quiet recovery lounge</span><span><Check size={14} /> Coffee, always</span></div>
          <a className="arrow-link" href="#visit">Come take a look <ArrowUpRight size={15} /></a>
        </div>
        <div className="studio-side-text">A PLACE TO PRACTICE <span>CHICAGO · EST. 2014</span></div>
      </section>

      <section className="membership-section section-pad" id="plans">
        <div className="section-topline"><span className="eyebrow">04 — YOUR NEXT CHAPTER</span><span className="section-note">Simple plans. No weird pressure. Change your plan any time.</span></div>
        <div className="membership-heading"><h2>Find your<br /><em>way in.</em></h2><p>Start with what works today. We'll be here for wherever you go next.</p></div>
        <div className="plans-grid">
          {plans.map((plan, index) => <motion.article className={'plan-card ' + (plan.featured ? 'featured' : '')} key={plan.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: index * .08 }}>
            {plan.featured && <div className="plan-ribbon"><span>MEMBER FAVORITE</span><span>✳</span></div>}
            <div className="plan-top"><div><span className="eyebrow">{plan.id === 'founders' ? 'THE PERSONAL ONE' : plan.id === 'all-access' ? 'THE FULL PICTURE' : 'THE OPEN DOOR'}</span><h3>{plan.name}</h3><p>{plan.description}</p></div><span className="plan-mark">{index === 0 ? '01' : index === 1 ? '02' : '03'}</span></div>
            <div className="plan-price">{formatMoney(plan.price, plan.currency || 'USD')}<span>/ month</span></div>
            <div className="plan-rule" />
            <ul>{plan.features.map((feature) => <li key={feature}><Check size={15} />{feature}</li>)}</ul>
            <button className={'button ' + (plan.featured ? 'button-lime' : 'button-plan')} disabled={Boolean(busyPlan)} onClick={() => choosePlan(plan.id)}>{busyPlan === plan.id ? 'One moment…' : 'Choose ' + plan.name}<ArrowUpRight size={16} /></button>
            <small className="plan-legal">One month · renew manually</small>
          </motion.article>)}
        </div>
        <div className="plan-footnote"><span>NOT SURE WHERE TO START?</span><a href="mailto:hello@northstar.club">Come by for a tour. First one's on us. <ArrowUpRight size={14} /></a></div>
      </section>

      <section className="community-section section-pad">
        <div className="community-heading"><span className="eyebrow">A LITTLE MORE HUMAN</span><h2>There is no<br />one way to <em>strong.</em></h2></div>
        <div className="community-content">
          {reviews.length ? <div className="review-cards">{reviews.slice(0, 2).map((review) => <article className="review-card" key={review._id}><div className="review-stars">{Array.from({ length: review.rating || 5 }, (_, i) => <Star key={i} size={13} fill="currentColor" />)}</div><p>“{review.comment || 'A great session with a coach who really pays attention.'}”</p><span>{review.user?.name || 'Northstar member'} <i>/</i> {review.session?.title || 'Member note'}</span></article>)}</div> : <div className="community-note"><span className="community-icon"><Heart size={20} /></span><p>Not keeping score.<br /><em>Keeping each other going.</em></p><span>Our members make the club. Come find your people.</span></div>}
          <div className="community-stats"><div><strong>01</strong><span>Coach-led, always</span></div><div><strong>02</strong><span>Strength & recovery</span></div><div><strong>03</strong><span>Your neighborhood club</span></div></div>
          <button className="arrow-link community-link" onClick={bookSession}>Find your first class <ArrowUpRight size={15} /></button>
        </div>
      </section>

      <section className="visit-section" id="visit">
        <div className="visit-topline"><span className="eyebrow">COME FIND US</span><span>THE COFFEE IS GOOD, TOO.</span></div>
        <div className="visit-main"><h2>Better days<br />start <em>here.</em></h2><div className="visit-cta"><p>214 W Huron Street<br />Chicago, IL 60654</p><p>Weekdays 6am — 10pm<br />Weekends 8am — 8pm</p><a className="button button-lime" href="#plans">Find your way in <ArrowUpRight size={16} /></a></div></div>
        <div className="visit-stamp">NORTH<br />STAR <span>✳</span><small>ATHLETIC CLUB</small></div>
      </section>
    </main>

    <footer className="site-footer">
      <Link to="/" className="wordmark"><span className="brand-mark">N</span><span>NORTHSTAR<small>ATHLETIC CLUB</small></span></Link>
      <div className="footer-links"><a href="#approach">Our approach</a><a href="#classes">Classes</a><a href="#plans">Membership</a><a href="mailto:hello@northstar.club">Contact</a></div>
      <div className="footer-note">© 2025 NORTHSTAR ATHLETIC CLUB <span>MADE FOR THE LONG GAME.</span></div>
    </footer>
  </div>;
}
