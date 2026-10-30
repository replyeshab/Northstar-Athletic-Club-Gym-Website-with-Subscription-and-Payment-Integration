import { useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Eye, EyeOff, X } from 'lucide-react';
import { useAuth } from './auth';
import { post } from './api';
import HomePage from './pages/HomePage';
import MemberPage from './pages/MemberPage';
import AdminPage from './pages/AdminPage';

export default function App() {
  const { user, loading, signIn, signUp } = useAuth();
  const [authState, setAuthState] = useState({ open: false, mode: 'signup', after: null });
  const location = useLocation();

  const requestAuth = (mode = 'signup', after = null) => setAuthState({ open: true, mode, after });

  return <>
    <Routes>
      <Route path="/" element={<HomePage onAuthRequest={requestAuth} />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/member" element={loading ? <LoadingPage /> : user ? <MemberPage /> : <Navigate to="/" replace state={{ signIn: true }} />} />
      <Route path="/admin" element={loading ? <LoadingPage /> : user?.role === 'admin' ? <AdminPage /> : user ? <Navigate to="/member" replace /> : <Navigate to="/" replace state={{ signIn: true }} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <AnimatePresence>
      {authState.open && <AuthModal
        key={location.pathname + authState.mode}
        mode={authState.mode}
        signIn={signIn}
        signUp={signUp}
        afterAuth={authState.after}
        onClose={() => setAuthState((state) => ({ ...state, open: false }))}
      />}
    </AnimatePresence>
  </>;
}

function LoadingPage() {
  return <div className="loading-screen"><span className="brand-mark">N</span><p>Getting your space ready</p></div>;
}

function AuthModal({ mode: initialMode, signIn, signUp, afterAuth, onClose }) {
  const [mode,setMode]=useState(initialMode),[error,setError]=useState(''),[busy,setBusy]=useState(false),[showPassword,setShowPassword]=useState(false),[sent,setSent]=useState(false);
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true); const form=new FormData(event.currentTarget);
    try {
      if(mode==='forgot') { await post('/auth/forgot-password',{email:form.get('email')}); setSent(true); return; }
      const user=mode==='signup'?await signUp(form.get('name'),form.get('email'),form.get('password')):await signIn(form.get('email'),form.get('password'));
      onClose(); if(afterAuth) await afterAuth(user);
    } catch(err) { setError(err.message); } finally { setBusy(false); }
  }
  function changeMode(next) { setMode(next); setError(''); setSent(false); }
  const heading=mode==='signup'?'Come on in.':mode==='forgot'?'Let’s get you back.':'Good to see you.';
  return <motion.div className="modal-scrim" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={event=>event.target===event.currentTarget&&onClose()}>
    <motion.section className="auth-modal" initial={{y:22,opacity:0,scale:.98}} animate={{y:0,opacity:1,scale:1}} exit={{y:14,opacity:0,scale:.98}} transition={{duration:.24}}>
      <button className="icon-button modal-close" aria-label="Close" onClick={onClose}><X size={18}/></button>
      <a className="wordmark modal-wordmark" href="/"><span className="brand-mark">N</span><span>NORTHSTAR<small>ATHLETIC CLUB</small></span></a>
      <p className="eyebrow olive">YOUR NEXT STRONG DAY STARTS HERE</p>
      <h2>{heading}</h2>
      <p className="muted">{mode==='signup'?'Create your member account to book your first class.':mode==='forgot'?'We’ll email you a secure link to reset your password.':'Sign in and pick up right where you left off.'}</p>
      <form className="auth-form" onSubmit={submit}>
        {mode==='signup'&&<label>Your name<input name="name" autoComplete="name" placeholder="Alex Morgan" required minLength="2" maxLength="80"/></label>}
        <label>Email address<input type="email" name="email" autoComplete="email" placeholder="you@example.com" required/></label>
        {mode!=='forgot'&&<label>Password<span className="password-field"><input name="password" type={showPassword?'text':'password'} autoComplete={mode==='signup'?'new-password':'current-password'} placeholder="At least 8 characters" required minLength="8"/><button type="button" className="password-eye" aria-label={showPassword?'Hide password':'Show password'} onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={17}/>:<Eye size={17}/>}</button></span></label>}
        {mode==='login'&&<button type="button" className="auth-forgot" onClick={()=>changeMode('forgot')}>Forgot password?</button>}
        {error&&<div className="form-error" role="alert">{error}</div>}
        {sent&&<div className="form-success" role="status">If an account exists for that email, a reset link is on its way. Check your inbox.</div>}
        {!sent&&<button className="button button-dark button-wide" disabled={busy}>{busy?'One moment…':mode==='signup'?'Create my account':mode==='forgot'?'Send reset link':'Sign in'}<ArrowLeft className="button-arrow rotate-180" size={17}/></button>}
      </form>
      <p className="auth-switch">{mode==='signup'?'Already a member?':mode==='forgot'?'Remember your password?':'New around here?'} <button onClick={()=>changeMode(mode==='signup'?'login':'login')}>{mode==='signup'?'Sign in':'Back to sign in'}</button>{mode==='login'&&<> <span>·</span> <button onClick={()=>changeMode('signup')}>Create an account</button></>}</p>
      <p className="legal-note">By continuing, you agree to our <a href="#terms" onClick={onClose}>member terms</a> and privacy policy.</p>
    </motion.section>
  </motion.div>;
}

function ResetPasswordPage() {
  const [params]=useSearchParams(); const token=params.get('token')||'';
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[complete,setComplete]=useState(false);
  async function submit(event) { event.preventDefault(); setError(''); const form=new FormData(event.currentTarget); const password=String(form.get('password')||''); if(password!==String(form.get('confirm')||'')){setError('Those passwords do not match.');return;} setBusy(true); try { await post('/auth/reset-password',{token,password}); setComplete(true); } catch(err) { setError(err.message); } finally { setBusy(false); } }
  return <div className="reset-password-page"><motion.section className="auth-modal reset-password-card" initial={{y:18,opacity:0}} animate={{y:0,opacity:1}}>
    <Link className="wordmark modal-wordmark" to="/"><span className="brand-mark">N</span><span>NORTHSTAR<small>ATHLETIC CLUB</small></span></Link>
    <p className="eyebrow olive">ACCOUNT RECOVERY</p><h2>{complete?'You’re back in.':'Choose a new password.'}</h2>
    <p className="muted">{complete?'Your password has been updated. Sign in with the new one.':'Use at least 8 characters. This secure link expires after 30 minutes.'}</p>
    {!complete&&<form className="auth-form" onSubmit={submit}>{!token&&<div className="form-error" role="alert">This reset link is missing or invalid. Request another link from sign in.</div>}<label>New password<input name="password" type="password" autoComplete="new-password" minLength="8" maxLength="128" required disabled={!token}/></label><label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" minLength="8" maxLength="128" required disabled={!token}/></label>{error&&<div className="form-error" role="alert">{error}</div>}<button className="button button-dark button-wide" disabled={busy||!token}>{busy?'Saving…':'Update password'}<ArrowLeft className="button-arrow rotate-180" size={17}/></button></form>}
    <p className="auth-switch"><Link to="/" state={{signIn:true}}>Back to sign in</Link></p>
  </motion.section></div>;
}
