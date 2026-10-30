import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Bell, CalendarDays, Check, ChevronRight, CircleUserRound, Clock3, CreditCard, Dumbbell, LogOut, Menu, MessageSquareText, ShieldCheck, Sparkles, Star, Trash2, X } from 'lucide-react';
import { api, formatDate, formatMoney, formatTime, patch, post } from '../api';
import { useAuth } from '../auth';
import { openRazorpayCheckout } from '../razorpay';

const navItems = [
  ['overview', 'Overview', Sparkles], ['classes', 'Find a class', Dumbbell], ['schedule', 'My schedule', CalendarDays],
  ['membership', 'Membership & billing', CreditCard], ['notifications', 'Notifications', Bell], ['profile', 'My profile', CircleUserRound],
];

export default function MemberPage() {
  const { user: authUser, signOut } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const [profile, setProfile] = useState(null), [sessions, setSessions] = useState([]), [bookings, setBookings] = useState([]);
  const [notifications, setNotifications] = useState([]), [payments, setPayments] = useState([]), [plans, setPlans] = useState([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [toast, setToast] = useState('');
  const [reviewing, setReviewing] = useState(''), [mobileNav, setMobileNav] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [p, s, b, n, pay, pl] = await Promise.all([api('/profile'), api('/sessions'), api('/me/bookings'), api('/notifications'), api('/payments/history'), api('/plans')]);
      setProfile(p.data); setSessions(s.data || []); setBookings(b.data || []); setNotifications(n.data || []); setPayments(pay.data || []); setPlans(pl.data || []); setError('');
    } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (params.get('checkout') === 'success') {
      setToast('Thanks — we are confirming your membership. This can take a few seconds.');
      const next = new URLSearchParams(params); next.delete('checkout'); setParams(next, { replace: true });
      const timer = setTimeout(refresh, 1800); return () => clearTimeout(timer);
    }
  }, [params, refresh, setParams]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4200); return () => clearTimeout(timer); }, [toast]);

  const future = useMemo(() => bookings.filter((b) => b.session && new Date(b.session.date) > new Date() && b.status === 'booked').sort((a,b) => new Date(a.session.date)-new Date(b.session.date)), [bookings]);
  const bookedIds = useMemo(() => new Set(bookings.filter((b) => b.status === 'booked').map((b) => String(b.session?._id))), [bookings]);
  const user = profile?.user || authUser, membership = profile?.membership, unread = notifications.filter((n) => !n.readAt).length;
  const changeTab = (name) => { setParams(name === 'overview' ? {} : { tab: name }); setMobileNav(false); };

  async function perform(action, success) {
    setBusy(true); setError('');
    try { await action(); if (success) setToast(success); await refresh(); return true; }
    catch (err) { setError(err.message); return false; }
    finally { setBusy(false); }
  }
  const book = (id) => perform(() => post('/sessions/' + id + '/book', {}), 'You’re on the list. See you there.');
  const cancel = (id) => perform(() => api('/sessions/' + id + '/book', { method: 'DELETE' }), 'Your spot has been released.');
  const checkout = async (planId) => {
    setBusy(true); setError('');
    try {
      const result = await post('/create-order', { planId });
      await openRazorpayCheckout({
        checkout: result.data,
        user: authUser,
        onSuccess: async (payment) => {
          try {
            await post('/verify-payment', payment);
            setToast('Your membership is active.');
            await refresh();
          } catch (err) { setError(err.message); }
          finally { setBusy(false); }
        },
        onDismiss: () => setBusy(false),
        onError: (err) => { setError(err.message); setBusy(false); },
      });
    } catch (err) { setError(err.message); setBusy(false); }
  };
  const cancelMembership = () => perform(() => post('/payments/cancel-membership', {}), 'Auto-renew is off. Your access stays active through this billing period.');
  const resumeMembership = () => perform(() => post('/payments/resume-membership', {}), 'Auto-renew is back on.');
  const markRead = () => perform(() => post('/notifications/read-all', {}));
  async function saveProfile(event) {
    event.preventDefault(); setBusy(true); setError('');
    const f = new FormData(event.currentTarget);
    try { const result = await patch('/profile', { name: f.get('name'), phone: f.get('phone'), goal: f.get('goal') }); setProfile((p) => ({ ...p, user: result.data.user })); setToast('Your details are saved.'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const sendReview = async (sessionId, values) => { if (await perform(() => post('/sessions/' + sessionId + '/reviews', values), 'Thanks for sharing a note with the club.')) setReviewing(''); };
  async function logout() { await signOut(); navigate('/', { replace: true, state: { signIn: true } }); }
  async function requestPasswordReset() { setBusy(true); setError(''); try { await post('/auth/forgot-password', { email: authUser?.email }); setToast('Password reset requested. If email is configured, check your inbox.'); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  async function deleteAccount(password) {
    setBusy(true); setError('');
    try { await api('/account', { method: 'DELETE', body: JSON.stringify({ password, confirmation: 'DELETE' }) }); await signOut(); navigate('/', { replace: true }); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return <div className="portal-shell">
    {toast && <div className="toast" role="status"><span><Check size={16} />{toast}</span><button onClick={() => setToast('')} aria-label="Dismiss"><X size={16} /></button></div>}
    <header className="portal-topbar">
      <Link to="/" className="wordmark"><span className="brand-mark">N</span><span>NORTHSTAR<small>ATHLETIC CLUB</small></span></Link>
      <div className="portal-topbar-right"><span className="portal-welcome">YOUR MEMBER SPACE</span>{authUser?.role === 'admin' && <Link className="admin-switch" to="/admin"><ShieldCheck size={15} /> Admin</Link>}<button className="portal-signout" onClick={logout}><LogOut size={15}/><span>Sign out</span></button><button className="portal-avatar" onClick={() => changeTab('profile')} title="My profile">{(user?.name || 'N')[0]}</button></div>
    </header>
    <div className="portal-layout">
      <aside className={'portal-sidebar ' + (mobileNav ? 'mobile-open' : '')}>
        <div className="sidebar-member"><span className="member-avatar-large">{(user?.name || 'N').split(' ').map((n) => n[0]).slice(0,2).join('')}</span><div><b>{user?.name}</b><span>{membership?.plan?.name || 'Northstar member'}</span></div><button className="sidebar-close icon-button" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={18}/></button></div>
        <span className="eyebrow sidebar-label">YOUR CLUB</span>
        <nav className="portal-nav">{navItems.map(([id,label,Icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => changeTab(id)}><Icon size={17}/><span>{label}</span>{id === 'notifications' && unread > 0 && <i>{unread}</i>}{tab === id && <ChevronRight size={14} className="nav-chevron"/>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="sidebar-help"><span className="help-dot">✳</span><b>Need a hand?</b><p>Our team is here for you, even between sets.</p><a href="mailto:hello@northstar.club">Talk to the club <ArrowUpRight size={13}/></a></div></div>
      </aside>
      <main className="portal-main">
        <button className="mobile-portal-menu" onClick={() => setMobileNav(true)}><Menu size={18}/> Menu</button>
        {error && <div className="portal-error" role="alert"><span>{error}</span><button onClick={() => setError('')}><X size={15}/></button></div>}
        {tab === 'overview' && <Overview member={user?.name || 'Member'} membership={membership} bookings={future} sessions={sessions} changeTab={changeTab}/>}
        {tab === 'classes' && <Classes sessions={sessions} bookedIds={bookedIds} busy={busy} onBook={book} membership={membership} onPlans={() => changeTab('membership')}/>}
        {tab === 'schedule' && <Schedule bookings={bookings} busy={busy} onCancel={cancel} onReview={setReviewing} onFind={() => changeTab('classes')}/>}
        {tab === 'membership' && <Membership membership={membership} plans={plans} payments={payments} busy={busy} onChoose={checkout} onCancel={cancelMembership} onResume={resumeMembership}/>}
        {tab === 'notifications' && <Notifications items={notifications} unread={unread} onRead={markRead}/>}
        {tab === 'profile' && <Profile user={user} busy={busy} onSave={saveProfile} onDelete={deleteAccount} onResetPassword={requestPasswordReset}/>}
      </main>
    </div>
    <AnimatePresence>{reviewing && <ReviewModal onClose={() => setReviewing('')} onSubmit={(values) => sendReview(reviewing, values)} busy={busy}/>}</AnimatePresence>
  </div>;
}

function Title({ eyebrow, title, description, action }) {
  return <div className="portal-page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}
function Overview({ member, membership, bookings, sessions, changeTab }) {
  const upcoming = sessions.filter((s) => new Date(s.date) > new Date()).slice(0,3), next = bookings[0], first = member.split(' ')[0];
  return <div className="portal-tab">
    <Title eyebrow="YOUR SPACE, YOUR PACE" title={<>Good to see you, <em>{first}.</em></>} description="A little consistency goes a long way. Let’s keep yours going." action={<span className="member-since"><Sparkles size={15}/> MEMBER SINCE {new Date().getFullYear()}</span>}/>
    <div className="member-hero-grid">
      <div className="member-membership-card"><div className="member-card-top"><span className="eyebrow">YOUR MEMBERSHIP</span><span className={'membership-status ' + (membership?.status === 'active' ? 'status-active' : '')}><i/>{membership?.status || 'No plan yet'}</span></div><h2>{membership?.plan?.name || 'Your next chapter'}</h2><p>{membership?.plan?.description || 'Choose the membership that feels right for you.'}</p><div className="membership-card-bottom"><div>{membership?.plan ? <><b>{formatMoney(membership.plan.price, membership.plan.currency || 'USD')}</b><span> / month</span></> : <span>Start when you’re ready</span>}</div><button onClick={() => changeTab('membership')}>{membership ? 'Manage plan' : 'Explore plans'} <ArrowUpRight size={15}/></button></div><span className="card-orbit orbit-one"/><span className="card-orbit orbit-two"/></div>
      <div className="next-session-card"><div className="next-card-head"><span className="eyebrow">UP NEXT</span><CalendarDays size={16}/></div>{next ? <><div className="next-date">{formatDate(next.session.date, { weekday: 'long', month: 'long', day: 'numeric' })}</div><h3>{next.session.title}</h3><p>{formatTime(next.session.date)} · {next.session.duration} min · {next.session.coach}</p><div className="next-session-footer"><span><i className="status-pulse"/> BOOKED</span><button onClick={() => changeTab('schedule')}>Your schedule <ArrowUpRight size={14}/></button></div></> : <><div className="next-empty-mark"><CalendarDays size={20}/></div><h3>Make a little time for you.</h3><p>Your next class is one good choice away.</p><button className="text-link" onClick={() => changeTab('classes')}>Find a class <ArrowUpRight size={14}/></button></>}</div>
    </div>
    <div className="quick-stats"><div><span>CLASSES BOOKED</span><b>{bookings.length.toString().padStart(2,'0')}</b><small>UPCOMING SESSIONS</small></div><div><span>MEMBER SINCE</span><b>{new Date().getFullYear()}</b><small>YOUR YEAR TO BUILD</small></div><div><span>CLUB STATUS</span><b className="stat-status"><i/> {membership?.status === 'active' ? 'Active' : 'Ready'}</b><small>{membership?.status === 'active' ? 'GOOD TO GO' : 'YOUR SPACE IS READY'}</small></div><div className="quick-stat-link" onClick={() => changeTab('notifications')}><span>CLUB NOTES</span><b><Bell size={19}/></b><small>SEE WHAT’S NEW <ArrowUpRight size={12}/></small></div></div>
    <div className="portal-section-heading"><div><span className="eyebrow">OPEN SPOTS, GOOD COACHES</span><h2>On the calendar.</h2></div><button className="arrow-link" onClick={() => changeTab('classes')}>See all classes <ArrowUpRight size={14}/></button></div>
    <div className="portal-class-list">{upcoming.map((item) => <ClassRow key={item._id} item={item} onClick={() => changeTab('classes')}/>)}</div>
    <div className="portal-quote"><span className="quote-star">✳</span><p>“The best workout is the one that makes you want to come back.”</p><span>— THE NORTHSTAR WAY</span></div>
  </div>;
}
function Classes({ sessions, bookedIds, busy, onBook, membership, onPlans }) {
  const [filter, setFilter] = useState('All classes'), categories = ['All classes', ...new Set(sessions.map((s) => s.category))];
  const rows = sessions.filter((s) => filter === 'All classes' || s.category === filter);
  const active = membership && ['active','trialing'].includes(membership.status);
  return <div className="portal-tab"><Title eyebrow="SOMETHING GOOD IS ON THE CALENDAR" title={<>Move your <em>way.</em></>} description="Find a class that fits your day. Your spot is just a tap away."/>
    {!active && <div className="membership-callout"><span><ShieldCheck size={18}/></span><div><b>Classes are part of membership.</b><small>Choose a plan to reserve your first spot.</small></div><button onClick={onPlans}>Explore plans <ArrowUpRight size={14}/></button></div>}
    <div className="filter-pills">{categories.map((c) => <button key={c} className={filter===c?'selected':''} onClick={() => setFilter(c)}>{c}</button>)}</div>
    {!rows.length ? <Empty title="We’re setting the schedule." detail="Check back soon for upcoming sessions."/> : <div className="class-catalog">{rows.map((s) => <article className="catalog-card" key={s._id}><div className={'catalog-icon icon-'+String(s.category).toLowerCase()}><Dumbbell size={21}/></div><div className="catalog-details"><span className="class-category">{s.category} <i>/</i> {s.level}</span><h3>{s.title}</h3><p>{s.coach} · {s.room}</p><div className="catalog-meta"><span><CalendarDays size={14}/> {formatDate(s.date,{weekday:'short',month:'short',day:'numeric'})}</span><span><Clock3 size={14}/> {formatTime(s.date)} · {s.duration} min</span></div></div><div className="catalog-capacity"><span className="eyebrow">SPOTS</span><b>{Math.max(0,s.capacity-s.seatsBooked)}</b><small>of {s.capacity}</small></div><button className={'button '+(bookedIds.has(String(s._id))?'button-booked':'button-dark')} disabled={busy||bookedIds.has(String(s._id))||s.seatsBooked>=s.capacity} onClick={() => onBook(s._id)}>{bookedIds.has(String(s._id))?<><Check size={15}/> You’re in</>:s.seatsBooked>=s.capacity?'Full':<>Save my spot <ArrowUpRight size={14}/></>}</button></article>)}</div>}
  </div>;
}
function Schedule({ bookings, busy, onCancel, onReview, onFind }) {
  const [filter,setFilter]=useState('upcoming');
  const sorted=[...bookings].filter((b)=>b.session).sort((a,b)=>new Date(a.session.date)-new Date(b.session.date));
  const shown=sorted.filter((b)=>{const future=new Date(b.session.date)>new Date();return filter==='upcoming'?future&&b.status==='booked':filter==='past'?!future&&b.status!=='cancelled':b.status==='cancelled'});
  return <div className="portal-tab"><Title eyebrow="YOUR TIME, PUT ASIDE" title={<>My <em>schedule.</em></>} description="All the good things you’ve made time for."/>
    <div className="filter-pills">{[['upcoming','Upcoming'],['past','Past classes'],['cancelled','Cancelled']].map(([id,label])=><button key={id} className={filter===id?'selected':''} onClick={()=>setFilter(id)}>{label}</button>)}</div>
    {shown.length?<div className="schedule-bookings">{shown.map((b)=><article className="booking-card" key={b._id}><div className="booking-date-block"><b>{formatDate(b.session.date,{day:'2-digit'})}</b><span>{formatDate(b.session.date,{month:'short'}).toUpperCase()}</span></div><div className="booking-info"><span className="class-category">{b.session.category} <i>/</i> {new Date(b.session.date)>new Date()?'UPCOMING':'COMPLETED'}</span><h3>{b.session.title}</h3><p>{formatDate(b.session.date,{weekday:'long'})} · {formatTime(b.session.date)} · {b.session.coach}</p></div><div className="booking-actions">{new Date(b.session.date)>new Date()&&b.status==='booked'?<button className="button button-outline button-small" disabled={busy} onClick={()=>onCancel(b.session._id)}>Cancel spot</button>:b.status==='booked'&&<button className="text-link" onClick={()=>onReview(b.session._id)}><Star size={14}/> Leave a review</button>}</div></article>)}</div>:<Empty title={filter==='upcoming'?'Nothing booked just yet.':'No classes here yet.'} detail={filter==='upcoming'?'Pick something good from the schedule and save your spot.':'Your class history will show up here.'} action={filter==='upcoming'&&<button className="button button-dark" onClick={onFind}>Find a class <ArrowUpRight size={14}/></button>}/>}
  </div>;
}
function Membership({ membership, plans, payments, busy, onChoose, onCancel, onResume }) {
  const active=membership&&['active','trialing','past_due'].includes(membership.status);
  return <div className="portal-tab"><Title eyebrow="SIMPLE PLANS, LOTS OF ROOM" title={<>Membership & <em>billing.</em></>} description="Your club details, all in one place."/>
    <div className="billing-current"><div className="billing-current-top"><span className="eyebrow">CURRENT PLAN</span><span className={'membership-status '+(active?'status-active':'')}><i/> {membership?.status||'No active plan'}</span></div><div className="billing-current-main"><div><h2>{membership?.plan?.name||'Find your way in.'}</h2><p>{membership?.plan?.description||'Choose a plan to unlock your club benefits.'}</p></div>{membership?.plan&&<div className="billing-price"><b>{formatMoney(membership.plan.price, membership.plan.currency || 'USD')}</b><span>/ month</span></div>}</div>{membership?.currentPeriodEnd&&<div className="billing-current-foot"><span>{membership.razorpaySubscriptionId?(membership.cancelAtPeriodEnd?'Auto-renew off · access ends':'Auto-renews · next charge'):'Access ends'} {formatDate(membership.currentPeriodEnd,{month:'long',day:'numeric',year:'numeric'})}</span>{active&&membership.razorpaySubscriptionId&&(membership.cancelAtPeriodEnd?<button onClick={onResume} disabled={busy}>Turn auto-renew back on</button>:<button onClick={onCancel} disabled={busy}>Cancel auto-renew</button>)}</div>}</div>
    {!active&&<><div className="portal-section-heading"><div><span className="eyebrow">CHOOSE WHAT FEELS RIGHT</span><h2>Your next chapter.</h2></div></div><div className="member-plans">{plans.map((p)=><article className={'member-plan '+(p.featured?'highlight':'')} key={p.id}><span className="eyebrow">{p.featured?'MEMBER FAVORITE':'NORTHSTAR MEMBERSHIP'}</span><h3>{p.name}</h3><p>{p.description}</p><div className="member-plan-price">{formatMoney(p.price, p.currency || 'INR')}<span> / month</span></div><small className="member-plan-renewal">One month · renew manually</small><ul>{p.features.map((f)=><li key={f}><Check size={14}/>{f}</li>)}</ul><button className="button button-dark" disabled={busy} onClick={()=>onChoose(p.id)}>Choose {p.name} <ArrowUpRight size={14}/></button></article>)}</div></>}
    <div className="portal-section-heading billing-history-heading"><div><span className="eyebrow">PAYMENT HISTORY</span><h2>All squared away.</h2></div></div>
    {payments.length?<div className="payment-list">{payments.map((p)=><div className="payment-row" key={p._id}><span className="payment-icon"><CreditCard size={17}/></span><div><b>{p.description}</b><small>{formatDate(p.createdAt,{month:'short',day:'numeric',year:'numeric'})}</small></div><span className={'payment-status '+p.status}>{p.status}</span><strong>{formatMoney(p.amount,p.currency?.toUpperCase())}</strong></div>)}</div>:<Empty compact title="Your payment history will live here." detail="It’ll update automatically when your first payment clears."/>}
  </div>;
}
function Notifications({ items, unread, onRead }) {
  return <div className="portal-tab"><Title eyebrow="NOTES FROM YOUR CLUB" title={<>Good to <em>know.</em></>} description="Class updates, membership notes, and a little encouragement." action={unread>0&&<button className="button button-outline button-small" onClick={onRead}>Mark all read <Check size={14}/></button>}/>
    {items.length?<div className="notification-list">{items.map((n)=><article className={'notification-card '+(!n.readAt?'unread':'')} key={n._id}><span className={'notification-symbol type-'+n.type}>{n.type==='class'?<CalendarDays size={17}/>:n.type==='billing'?<CreditCard size={17}/>:n.type==='success'?<Check size={17}/>:<Bell size={17}/>}</span><div><h3>{n.title}</h3><p>{n.message}</p><small>{new Date(n.createdAt).toLocaleString()}</small></div>{!n.readAt&&<i className="unread-dot"/>}</article>)}</div>:<Empty title="No notes, no worries." detail="When there’s something from the club, it’ll show up here."/>}
  </div>;
}
function Profile({ user, busy, onSave, onDelete, onResetPassword }) {
  return <div className="portal-tab"><Title eyebrow="A FEW DETAILS ABOUT YOU" title={<>Your <em>profile.</em></>} description="Keep your details up to date so we can make your time here feel more personal."/>
    <form className="profile-form" onSubmit={onSave}><div className="profile-avatar-row"><span className="profile-avatar">{user?.name?.[0]||'N'}</span><div><b>{user?.name}</b><span>Member since {formatDate(user?.createdAt||new Date(),{month:'long',year:'numeric'})}</span></div><span className="profile-member-tag"><ShieldCheck size={14}/> VERIFIED MEMBER</span></div>
      <div className="form-grid"><label>Full name<input name="name" defaultValue={user?.name} required minLength="2" maxLength="80"/></label><label>Email address<input type="email" value={user?.email||''} readOnly/><small>Email changes are handled by the club team.</small></label><label>Phone number<input name="phone" defaultValue={user?.phone||''} placeholder="+91 98765 43210"/></label><label>What are you working toward?<input name="goal" defaultValue={user?.goal||''} placeholder="Feel stronger, move better, have more energy…" maxLength="160"/></label></div>
      <div className="profile-form-footer"><span>Your details stay private and are only visible to the club team.</span><button className="button button-dark" disabled={busy}>Save changes <Check size={15}/></button></div></form>
    <div className="profile-contact"><div><MessageSquareText size={19}/><div><b>Want to update something else?</b><span>We can help with your email or account details.</span></div></div><a href="mailto:hello@northstar.club">Contact the club <ArrowUpRight size={14}/></a></div>
    <ProfileAccountActions busy={busy} onDelete={onDelete} onResetPassword={onResetPassword}/>
  </div>;
}

function ProfileAccountActions({ busy, onDelete, onResetPassword }) {
  const [deleting,setDeleting]=useState(false),[error,setError]=useState('');
  async function submit(event) { event.preventDefault(); const form=new FormData(event.currentTarget); if(form.get('confirmation')!=='DELETE'){setError('Type DELETE exactly to confirm.');return;} setError(''); await onDelete(String(form.get('password')||'')); }
  return <section className="profile-account-actions"><div className="profile-action-heading"><div><span className="eyebrow">ACCOUNT ACCESS</span><h3>Manage your account</h3><p>Sign out from the top bar, or manage your account security here.</p></div><div className="profile-account-buttons"><button className="button button-outline button-small" onClick={onResetPassword} disabled={busy}>Send password reset link</button></div></div>{!deleting?<button className="account-delete-trigger" onClick={()=>setDeleting(true)}><Trash2 size={15}/> Delete my account</button>:<form className="account-delete-form" onSubmit={submit}><p>Deleting removes your profile, class bookings and reviews. Any active auto-renewal will be stopped first; paid access remains through the current period. Payment records are retained without your profile for account history.</p><label>Current password<input name="password" type="password" autoComplete="current-password" required minLength="8"/></label><label>Type DELETE to confirm<input name="confirmation" autoComplete="off" required/></label>{error&&<div className="form-error" role="alert">{error}</div>}<div className="account-delete-buttons"><button type="button" className="button button-outline button-small" onClick={()=>{setDeleting(false);setError('')}} disabled={busy}>Keep account</button><button className="button button-danger" disabled={busy}><Trash2 size={15}/>{busy?'Removing…':'Permanently delete account'}</button></div></form>}</section>;
}

function ClassRow({ item, onClick }) {
  return <button className="portal-class-row" onClick={onClick}><span className="class-row-date"><b>{formatDate(item.date,{day:'2-digit'})}</b><small>{formatDate(item.date,{month:'short'}).toUpperCase()}</small></span><span className="class-row-main"><b>{item.title}</b><small>{item.category} · {item.coach}</small></span><span className="class-row-time">{formatTime(item.date)} · {item.duration} min</span><span className="class-row-spots">{Math.max(0,item.capacity-item.seatsBooked)} SPOTS</span><ArrowUpRight size={16}/></button>;
}
function Empty({ title, detail, action, compact=false }) {
  return <div className={'portal-empty '+(compact?'compact':'')}><span className="empty-orbit"><Sparkles size={18}/></span><h3>{title}</h3><p>{detail}</p>{action}</div>;
}
function ReviewModal({ onClose, onSubmit, busy }) {
  const [rating,setRating]=useState(5);
  function submit(event) { event.preventDefault(); const form=new FormData(event.currentTarget); onSubmit({rating,comment:form.get('comment')}); }
  return <motion.div className="modal-scrim" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={(e)=>e.target===e.currentTarget&&onClose()}><motion.div className="review-modal" initial={{y:18,opacity:0}} animate={{y:0,opacity:1}} exit={{y:12,opacity:0}}>
    <button className="icon-button modal-close" onClick={onClose} aria-label="Close"><X size={18}/></button><span className="eyebrow">A NOTE FOR THE CLUB</span><h2>How did it <em>feel?</em></h2><p>Your feedback helps us make the next class even better.</p>
    <form onSubmit={submit}><div className="rating-picker" aria-label="Choose a rating">{[1,2,3,4,5].map((v)=><button type="button" key={v} aria-label={v+' stars'} onClick={()=>setRating(v)}><Star size={27} fill={v<=rating?'currentColor':'none'}/></button>)}</div><label className="review-comment">Anything you want to share?<textarea name="comment" rows="4" maxLength="800" placeholder="The coach, the music, how your body felt afterwards…"/></label><button className="button button-dark button-wide" disabled={busy}>Send to the club <ArrowUpRight size={15}/></button></form>
  </motion.div></motion.div>;
}
