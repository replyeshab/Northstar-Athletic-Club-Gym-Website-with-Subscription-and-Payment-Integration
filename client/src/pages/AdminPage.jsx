import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, CalendarDays, Check, ChevronRight, CreditCard, Dumbbell, LayoutDashboard, LogOut, MessageSquareText, Plus, Search, ShieldCheck, Users, X } from 'lucide-react';
import { api, del, formatDate, formatMoney, formatTime, patch, post } from '../api';
import { useAuth } from '../auth';

const nav = [['overview','Overview',LayoutDashboard],['members','Members',Users],['classes','Classes',Dumbbell],['bookings','Bookings',CalendarDays],['reviews','Reviews',MessageSquareText],['memberships','Memberships',ShieldCheck],['payments','Payments',CreditCard]];
const endpoint = { overview:'/overview',members:'/members',classes:'/classes',bookings:'/bookings',reviews:'/reviews',memberships:'/memberships',payments:'/payments' };

export default function AdminPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [params,setParams]=useSearchParams();
  const tab=params.get('tab')||'overview';
  const [data,setData]=useState(null),[error,setError]=useState(''),[toast,setToast]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState(''),[showForm,setShowForm]=useState(false);
  const load=useCallback(async()=>{try{const result=await api('/admin'+endpoint[tab]+(tab==='members'&&search?'?q='+encodeURIComponent(search):''));setData(result.data);setError('')}catch(err){setError(err.message)}},[tab,search]);
  useEffect(()=>{load()},[load]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),4000);return()=>clearTimeout(t)},[toast]);
  const changeTab=(name)=>{setParams(name==='overview'?{}:{tab:name});setData(null)};
  async function action(fn,message){setBusy(true);setError('');try{await fn();setToast(message);await load()}catch(err){setError(err.message)}finally{setBusy(false)}}
  async function toggleMember(member){await action(()=>patch('/admin/members/'+member._id,{disabled:!member.disabled}),member.disabled?'Member account restored.':'Member account paused.')}
  async function attendance(item){const status=item.status==='attended'?'booked':'attended';await action(()=>patch('/admin/bookings/'+item._id+'/attendance',{status}),status==='attended'?'Attendance marked.':'Attendance status reset.')}
  async function removeReview(item){await action(()=>del('/admin/reviews/'+item._id),'Review removed.')}
  async function removeClass(item){if(!window.confirm('Cancel '+item.title+'? Booked members will be notified.'))return;await action(()=>del('/admin/classes/'+item._id),'Class cancelled and members notified.')}
  async function createClass(event){
    event.preventDefault();const form=new FormData(event.currentTarget);
    const date=new Date(form.get('date')+'T'+form.get('time'));
    const body={title:form.get('title'),category:form.get('category'),coach:form.get('coach'),date:date.toISOString(),duration:Number(form.get('duration')),capacity:Number(form.get('capacity')),level:form.get('level'),room:form.get('room'),published:true};
    await action(()=>post('/admin/classes',body),'New class added to the schedule.');setShowForm(false);
  }
  async function logout(){await signOut();navigate('/',{replace:true,state:{signIn:true}})}
  return <div className="admin-shell">
    {toast&&<div className="toast" role="status"><span><Check size={16}/>{toast}</span><button onClick={()=>setToast('')} aria-label="Dismiss"><X size={16}/></button></div>}
    <header className="admin-topbar"><Link to="/" className="wordmark"><span className="brand-mark">N</span><span>NORTHSTAR<small>ATHLETIC CLUB</small></span></Link><div className="admin-top-right"><span className="admin-mode"><ShieldCheck size={14}/> ADMIN CONSOLE</span><Link className="admin-preview" to="/member">Member view <ArrowUpRight size={14}/></Link><span className="admin-user">{user?.name}</span><button className="admin-signout" onClick={logout}><LogOut size={15}/><span>Sign out</span></button></div></header>
    <div className="admin-layout">
      <aside className="admin-sidebar"><div className="admin-label">CLUB OPERATIONS</div><nav>{nav.map(([id,label,Icon])=><button key={id} className={tab===id?'active':''} onClick={()=>changeTab(id)}><Icon size={17}/>{label}{tab===id&&<ChevronRight size={14}/>}</button>)}</nav><div className="admin-sidebar-foot"><span className="status-pulse"/> ALL SYSTEMS OPERATIONAL <small>Northstar · Chicago</small></div></aside>
      <main className="admin-main">
        <div className="admin-page-heading"><div><span className="eyebrow">NORTHSTAR / OPERATIONS</span><h1>{nav.find((item)=>item[0]===tab)?.[1]||'Overview'}</h1></div>{tab==='classes'&&<button className="button button-dark" onClick={()=>setShowForm(true)}><Plus size={16}/> Add a class</button>}</div>
        {error&&<div className="portal-error" role="alert"><span>{error}</span><button onClick={()=>setError('')}><X size={15}/></button></div>}
        {!data?<div className="admin-loading"><span className="loading-orbit"/>Loading club data…</div>:<>
          {tab==='overview'&&<Overview data={data} changeTab={changeTab}/>}
          {tab==='members'&&<Members data={data} search={search} setSearch={setSearch} onToggle={toggleMember} busy={busy}/>}
          {tab==='classes'&&<Classes data={data} onRemove={removeClass} busy={busy}/>}
          {tab==='bookings'&&<Bookings data={data} onAttendance={attendance} busy={busy}/>}
          {tab==='reviews'&&<Reviews data={data} onRemove={removeReview} busy={busy}/>}
          {tab==='memberships'&&<Memberships data={data}/>}
          {tab==='payments'&&<Payments data={data}/>}
        </>}
      </main>
    </div>
    {showForm&&<ClassForm onClose={()=>setShowForm(false)} onSubmit={createClass} busy={busy}/>}
  </div>;
}

function Overview({data,changeTab}){
  const metrics=[['MEMBERS',data.members,Users],['ACTIVE PLANS',data.activeMembers,ShieldCheck],['UPCOMING CLASSES',data.upcomingClasses,Dumbbell],['BOOKED SPOTS',data.bookings,CalendarDays]];
  return <><div className="admin-metrics">{metrics.map(([label,value,Icon])=><div className="admin-metric" key={label}><span>{label}</span><b>{value}</b><i><Icon size={18}/></i></div>)}</div>
    <div className="admin-revenue"><div><span className="eyebrow">ALL-TIME RECORDED REVENUE</span><b>{formatMoney(data.revenue)}</b><small>Recorded membership payments</small></div><div className="revenue-art"><span/><span/><span/><span/><span/><span/><span/></div></div>
    <div className="admin-overview-grid"><section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">LATEST SIGN-UPS</span><h2>New members.</h2></div><button onClick={()=>changeTab('members')}>All members <ArrowUpRight size={14}/></button></div>{data.latestMembers?.length?data.latestMembers.map((m)=><div className="admin-list-row" key={m._id}><span className="member-mini-avatar">{m.name?.[0]}</span><div><b>{m.name}</b><small>{m.email}</small></div><span className="admin-row-date">{formatDate(m.createdAt,{month:'short',day:'numeric'})}</span></div>):<AdminEmpty>No member sign-ups yet.</AdminEmpty>}</section>
      <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Payments.</h2></div><button onClick={()=>changeTab('payments')}>View payments <ArrowUpRight size={14}/></button></div>{data.latestPayments?.length?data.latestPayments.map((p)=><div className="admin-list-row" key={p._id}><span className="payment-icon"><CreditCard size={16}/></span><div><b>{p.user?.name||'Member payment'}</b><small>{p.description}</small></div><strong>{formatMoney(p.amount,p.currency?.toUpperCase())}</strong></div>):<AdminEmpty>Completed payments will appear here.</AdminEmpty>}</section></div>
    <section className="admin-note"><span className="help-dot">✳</span><div><b>Member notes are in.</b><p>{data.reviews} reviews have been shared by the club. Every response helps shape a better class.</p></div><button onClick={()=>changeTab('reviews')}>Read reviews <ArrowUpRight size={14}/></button></section>
  </>;
}

function Members({data,search,setSearch,onToggle,busy}){
  return <section className="admin-panel admin-table-panel"><div className="admin-panel-heading"><div><span className="eyebrow">PEOPLE WHO MAKE THIS PLACE</span><h2>{data.total} members</h2></div><label className="admin-search"><Search size={15}/><input placeholder="Search name or email" value={search} onChange={(e)=>setSearch(e.target.value)}/></label></div>
    {data.data?.length?<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>MEMBER</th><th>CONTACT</th><th>JOINED</th><th>STATUS</th><th></th></tr></thead><tbody>{data.data.map((m)=><tr key={m._id}><td><span className="member-table-name"><i>{m.name?.[0]}</i><b>{m.name}</b></span></td><td>{m.email}<small>{m.phone||'—'}</small></td><td>{formatDate(m.createdAt,{month:'short',day:'numeric',year:'numeric'})}</td><td><span className={'admin-status '+(m.disabled?'paused':'active')}><i/>{m.disabled?'Paused':'Member'}</span></td><td><button className="table-action" disabled={busy} onClick={()=>onToggle(m)}>{m.disabled?'Restore':'Pause access'}</button></td></tr>)}</tbody></table></div>:<AdminEmpty>No member accounts match that search.</AdminEmpty>}</section>;
}

function Classes({data,onRemove,busy}){
  return <section className="admin-panel admin-table-panel"><div className="admin-panel-heading"><div><span className="eyebrow">STUDIO SCHEDULE</span><h2>Classes & sessions</h2></div><span className="admin-count">{data.length} SESSIONS</span></div>
    {data.length?<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>CLASS</th><th>COACH / ROOM</th><th>DATE & TIME</th><th>CAPACITY</th><th></th></tr></thead><tbody>{data.map((s)=><tr key={s._id}><td><b>{s.title}</b><small>{s.category} · {s.level}</small></td><td>{s.coach}<small>{s.room}</small></td><td>{formatDate(s.date,{weekday:'short',month:'short',day:'numeric'})}<small>{formatTime(s.date)} · {s.duration} min</small></td><td>{s.seatsBooked}/{s.capacity} spots</td><td><button className="table-action danger" disabled={busy} onClick={()=>onRemove(s)}>Cancel class</button></td></tr>)}</tbody></table></div>:<AdminEmpty>There are no sessions in this window.</AdminEmpty>}</section>;
}

function Bookings({data,onAttendance,busy}){
  return <section className="admin-panel admin-table-panel"><div className="admin-panel-heading"><div><span className="eyebrow">RESERVATIONS & ATTENDANCE</span><h2>Class bookings</h2></div><span className="admin-count">{data.length} BOOKINGS</span></div>
    {data.length?<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>MEMBER</th><th>CLASS</th><th>SESSION</th><th>STATUS</th><th></th></tr></thead><tbody>{data.map((b)=><tr key={b._id}><td><b>{b.user?.name||'Member'}</b><small>{b.user?.email}</small></td><td>{b.session?.title||'Class removed'}<small>{b.session?.coach||''}</small></td><td>{b.session?.date?formatDate(b.session.date,{weekday:'short',month:'short',day:'numeric'}):'—'}<small>{b.session?.date?formatTime(b.session.date):''}</small></td><td><span className={'admin-status '+b.status}>{b.status}</span></td><td>{b.status!=='cancelled'&&<button className="table-action" disabled={busy} onClick={()=>onAttendance(b)}>{b.status==='attended'?'Undo attendance':'Mark attended'}</button>}</td></tr>)}</tbody></table></div>:<AdminEmpty>Member reservations will appear here.</AdminEmpty>}</section>;
}

function Reviews({data,onRemove,busy}){
  return <div className="admin-review-grid">{data.length?data.map((r)=><article className="admin-review-card" key={r._id}><div className="review-stars">{Array.from({length:r.rating},(_,i)=><span key={i}>★</span>)}</div><p>{r.comment||'No written comment.'}</p><div className="admin-review-by"><span className="member-mini-avatar">{r.user?.name?.[0]||'N'}</span><div><b>{r.user?.name||'Member'}</b><small>{r.session?.title||'Class'} · {formatDate(r.createdAt,{month:'short',day:'numeric'})}</small></div><button className="table-action danger" disabled={busy} onClick={()=>onRemove(r)}>Remove</button></div></article>):<div className="admin-panel"><AdminEmpty>No member reviews have been shared yet.</AdminEmpty></div>}</div>;
}

function Memberships({data}){
  return <section className="admin-panel admin-table-panel"><div className="admin-panel-heading"><div><span className="eyebrow">SUBSCRIPTION HEALTH</span><h2>Memberships</h2></div><span className="admin-count">{data.length} RECORDS</span></div>
    {data.length?<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>MEMBER</th><th>PLAN</th><th>STATUS</th><th>PERIOD END</th><th>RENEWAL</th></tr></thead><tbody>{data.map((m)=><tr key={m._id}><td><b>{m.user?.name||'Member'}</b><small>{m.user?.email}</small></td><td>{m.plan?.name||m.planId}<small>{m.plan?formatMoney(m.plan.price,m.plan.currency || 'USD')+' / month':''}</small></td><td><span className={'admin-status '+m.status}>{m.status}</span></td><td>{m.currentPeriodEnd?formatDate(m.currentPeriodEnd,{month:'short',day:'numeric',year:'numeric'}):'—'}</td><td>{m.razorpaySubscriptionId?(m.cancelAtPeriodEnd?'Ends this period':'Auto-renews'):'Manual renewal'}</td></tr>)}</tbody></table></div>:<AdminEmpty>Paid memberships will appear here after checkout.</AdminEmpty>}</section>;
}
function Payments({data}){
  return <section className="admin-panel admin-table-panel"><div className="admin-panel-heading"><div><span className="eyebrow">RAZORPAY PAYMENT RECORDS</span><h2>Payments</h2></div><span className="admin-count">{data.length} PAYMENTS</span></div>
    {data.length?<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>MEMBER</th><th>DESCRIPTION</th><th>DATE</th><th>STATUS</th><th>AMOUNT</th></tr></thead><tbody>{data.map((p)=><tr key={p._id}><td><b>{p.user?.name||'Member'}</b><small>{p.user?.email}</small></td><td>{p.description}</td><td>{formatDate(p.createdAt,{month:'short',day:'numeric',year:'numeric'})}</td><td><span className={'admin-status '+p.status}>{p.status}</span></td><td><b>{formatMoney(p.amount,p.currency?.toUpperCase())}</b></td></tr>)}</tbody></table></div>:<AdminEmpty>No completed payments yet.</AdminEmpty>}</section>;
}

function ClassForm({onClose,onSubmit,busy}){
  return <div className="modal-scrim" onMouseDown={(e)=>e.target===e.currentTarget&&onClose()}><div className="admin-form-modal"><button className="icon-button modal-close" onClick={onClose} aria-label="Close"><X size={18}/></button><span className="eyebrow">BUILD THE WEEK</span><h2>Add a class.</h2><p>Members will see it in the schedule as soon as you save.</p>
    <form className="admin-create-form" onSubmit={onSubmit}><div className="form-grid"><label>Class name<input name="title" placeholder="Strength foundations" required/></label><label>Category<input name="category" placeholder="Strength" required/></label><label>Coach<input name="coach" placeholder="Coach name" required/></label><label>Studio / room<input name="room" placeholder="Studio 01" defaultValue="Studio 01" required/></label><label>Date<input type="date" name="date" min={new Date().toISOString().slice(0,10)} required/></label><label>Start time<input type="time" name="time" required/></label><label>Duration (minutes)<input type="number" name="duration" min="15" max="240" defaultValue="50" required/></label><label>Capacity<input type="number" name="capacity" min="1" max="100" defaultValue="16" required/></label><label>Level<select name="level"><option>All levels</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label></div><button className="button button-dark button-wide" disabled={busy}>Add to schedule <Plus size={15}/></button></form>
  </div></div>;
}
function AdminEmpty({children}){return <div className="admin-empty"><span>✳</span><p>{children}</p></div>}
