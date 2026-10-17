import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, Building2, Eye, EyeOff, Heart, LockKeyhole,
  LogIn, Mail, ShieldCheck, UsersRound,
} from 'lucide-react';

import { getHospitals } from '../api/hospitalApi';
import { login } from '../api/authApi';
import BrandLogo from '../components/BrandLogo';
import { useHospital } from '../context/HospitalContext';
import { useAuth } from '../context/useAuth';
import type { Hospital } from '../types/hospital';
import hospitalSlideOne from '../assets/unitech-hospital-hero.png';
import hospitalSlideTwo from '../assets/unitech-hospital-slide-2.png';
import hospitalSlideThree from '../assets/unitech-hospital-slide-3.png';
import './HospitalSelection.css';

const BENEFITS = [
  { icon: ShieldCheck, title: 'Secure & Compliant', detail: 'Your data, our priority' },
  { icon: UsersRound, title: 'Integrated Care', detail: 'Seamless collaboration' },
  { icon: BarChart3, title: 'Modern & Efficient', detail: 'Built for healthcare professionals' },
  { icon: Heart, title: 'Better Patient Outcomes', detail: 'Technology for a healthier tomorrow' },
];

const HERO_SLIDES = [hospitalSlideOne, hospitalSlideTwo, hospitalSlideThree];

// Convenience only: pre-selects the hospital this browser last signed in to.
const LAST_HOSPITAL_KEY = 'lastSignInHospitalId';
function readLastHospitalId(): string | null {
  try { return localStorage.getItem(LAST_HOSPITAL_KEY); } catch { return null; }
}
function rememberLastHospitalId(id: string): void {
  try { localStorage.setItem(LAST_HOSPITAL_KEY, id); } catch { /* storage unavailable */ }
}

export default function HospitalSelection() {
  const navigate = useNavigate();
  const { selectHospital } = useHospital();
  const { session, loading: sessionLoading, setAuthenticatedSession } = useAuth();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [hospitalId, setHospitalId] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Separate from sign-in errors: only a failure to load hospitals locks the selector.
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    getHospitals()
      .then((data) => {
        // The server decides which hospitals are open for sign-in in this rollout.
        const enabled = data.filter((hospital) => hospital.signInEnabled !== false);
        setHospitals(enabled);
        if (enabled.length === 0) {
          setLoadError('No hospital is open for sign-in yet. Contact your administrator.');
          return;
        }
        // Pre-select the last hospital used, or the only one; with several,
        // make the user choose so nobody signs in to the wrong hospital.
        const last = readLastHospitalId();
        const preselected = enabled.find((hospital) => hospital.id === last) ?? (enabled.length === 1 ? enabled[0] : undefined);
        setHospitalId(preselected?.id ?? '');
      })
      .catch(() => setLoadError('Unable to connect to the HP1 clinical gateway.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!sessionLoading && session) {
      navigate(session.user.resourceType === 'Patient' ? `/portal/${session.hospitalId}/${session.user.id}` : `/hospital/${session.hospitalId}/dashboard`, { replace: true });
    }
  }, [navigate, session, sessionLoading]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % HERO_SLIDES.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hospital = hospitals.find((item) => item.id === hospitalId);
    if (!hospital) return;
    setError('');
    setSigningIn(true);
    try {
      const authenticatedSession = await login({ hospitalId, username, password, remember });
      setAuthenticatedSession(authenticatedSession);
      selectHospital(hospital);
      rememberLastHospitalId(hospital.id);
      navigate(authenticatedSession.user.resourceType === 'Patient' ? `/portal/${hospital.id}/${authenticatedSession.user.id}` : `/hospital/${hospital.id}/dashboard`);
    } catch (loginError) {
      const message = (loginError as { response?: { data?: { message?: string } } })
        .response?.data?.message;
      setError(message ?? 'Sign in failed. Check your credentials and hospital access.');
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-hero">
        <div className="login-slideshow" aria-hidden="true">
          {HERO_SLIDES.map((image, index) => (
            <div
              className={`login-slide ${index === activeSlide ? 'is-active' : ''}`}
              key={image}
              style={{ backgroundImage: `url(${image})` }}
            />
          ))}
        </div>
        <div className="login-hero-overlay" />
        <div className="login-hero-glow" />
        <div className="login-hero-grid" />
        <div className="login-hero-ribbon login-ribbon-one" />
        <div className="login-hero-ribbon login-ribbon-two" />
        <div className="login-hero-ribbon login-ribbon-three" />
        <div className="login-hero-ribbon login-ribbon-four" />
        <div className="login-hero-content">
          <BrandLogo inverse className="login-main-logo" />
          <div className="login-message">
            <h1>Empowering<br />Healthcare Together</h1>
            <p>A secure, integrated and intelligent healthcare management system for better patient care.</p>
          </div>
          <div className="login-benefits">
            {BENEFITS.map(({ icon: Icon, title, detail }) => (
              <div className="login-benefit" key={title}>
                <span><Icon size={23} /></span>
                <div><strong>{title}</strong><small>{detail}</small></div>
              </div>
            ))}
          </div>
          <div className="login-tagline">
            <span className="pulse-line" />
            <p>People&nbsp;&nbsp; | &nbsp;&nbsp;Technology&nbsp;&nbsp; | &nbsp;&nbsp;Better Care</p>
          </div>
          <div className="login-slide-controls" aria-label="Hospital background slides">
            {HERO_SLIDES.map((_, index) => (
              <button
                type="button"
                key={index}
                className={index === activeSlide ? 'is-active' : ''}
                aria-label={`Show background ${index + 1}`}
                aria-current={index === activeSlide ? 'true' : undefined}
                onClick={() => setActiveSlide(index)}
              ><span /></button>
            ))}
          </div>
        </div>
      </section>

      <section className="login-form-side">
        <div className="login-form-ribbon login-form-ribbon-one" />
        <div className="login-form-ribbon login-form-ribbon-two" />
        <div className="login-form-ribbon login-form-ribbon-three" />
        <form className="login-card" onSubmit={handleSubmit}>
          <BrandLogo className="login-card-logo" />
          <header>
            <h2>Welcome Back</h2>
            <p>Sign in to your account to continue</p>
          </header>

          <label className="login-field">
            <span>Hospital</span>
            <span className="login-control">
              <Building2 size={19} />
              <select value={hospitalId} onChange={(event) => setHospitalId(event.target.value)} disabled={loading || !!loadError}>
                <option value="">{loading ? 'Loading hospitals…' : loadError ? 'HP1 unavailable' : 'Select Hospital'}</option>
                {hospitals.map((hospital) => <option key={hospital.id} value={hospital.id}>{hospital.name}</option>)}
              </select>
            </span>
          </label>

          <label className="login-field">
            <span>Username / Email</span>
            <span className="login-control"><Mail size={19} /><input type="text" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Enter your username or email" autoComplete="username" required /></span>
          </label>

          <label className="login-field">
            <span>Password</span>
            <span className="login-control">
              <LockKeyhole size={19} />
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" required />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </span>
          </label>

          <div className="login-options">
            <label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Remember Me</span></label>
            <button type="button">Forgot Password?</button>
          </div>

          {(loadError || error) && <p className="login-error">{loadError || error}</p>}
          <button className="login-submit" type="submit" disabled={!hospitalId || !username || !password || signingIn}><LogIn size={21} /> {signingIn ? 'Signing In…' : 'Sign In'}</button>

          <footer className="login-security">
            <div><ShieldCheck size={21} /><strong>Secure access to UNITECH-EHR</strong></div>
            <p>Your information is protected with enterprise-grade security</p>
            <small>Your credentials are verified securely by Medplum.</small>
          </footer>
        </form>
      </section>
    </main>
  );
}
