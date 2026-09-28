import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowUp, BrainCircuit, Boxes, CircleStop, Cpu, Settings2 } from 'lucide-react';
import {
  getSevenModels, getSevenProfile, streamSevenChat, speakSeven,
  type SevenModel, type SevenProfile,
} from '../lib/seven';
import './SevenPage.css';
import { SevenBrainBackdrop } from './SevenBrainBackdrop';
import { useSevenOrbMotion } from './useSevenOrbMotion';

type ChatItem = { id: string; role: 'user' | 'assistant'; text: string };
const CHAT_KEY = 'seven-chat-v2';
const SESSION_KEY = 'seven-session-v2';
const MODEL_KEY = 'seven-openclaw-model';
const OPENCLAW_DEFAULT_CHOICE = '__openclaw_default__';
const REMOTE_DEFAULT_MIGRATION_KEY = 'seven-openclaw-remote-default-v1';

function loadSelectedModel(): string {
  if (localStorage.getItem(REMOTE_DEFAULT_MIGRATION_KEY) !== '1') {
    localStorage.setItem(REMOTE_DEFAULT_MIGRATION_KEY, '1');
    if (!localStorage.getItem(MODEL_KEY) || localStorage.getItem(MODEL_KEY)?.startsWith('ollama/')) {
      localStorage.setItem(MODEL_KEY, OPENCLAW_DEFAULT_CHOICE);
    }
  }
  const saved = localStorage.getItem(MODEL_KEY);
  if (saved === OPENCLAW_DEFAULT_CHOICE) return '';
  return saved || '';
}

function loadSession(): string {
  const stored = localStorage.getItem(SESSION_KEY);
  if (stored && /^[0-9a-f-]{36}$/i.test(stored)) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, id);
  return id;
}

function loadChat(): ChatItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(CHAT_KEY) || '[]');
    return Array.isArray(value) ? value.slice(-60).map((item) => item.role === 'assistant' && !item.text ? { ...item, text: 'Resposta interrompida.' } : item) : [];
  } catch { return []; }
}

function saveChat(items: ChatItem[]) {
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(items.slice(-60))); } catch { /* storage may be disabled */ }
}

export function SevenPage() {
  const [selectedModel, setSelectedModel] = useState(loadSelectedModel);
  const [models, setModels] = useState<SevenModel[]>([]);
  const [profile, setProfile] = useState<SevenProfile | null>(null);
  const [messages, setMessages] = useState<ChatItem[]>(loadChat);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'ready' | 'thinking' | 'preparing' | 'speaking'>('ready');
  const orbRef = useSevenOrbMotion(status);
  const [error, setError] = useState('');
  const [, setReplayReady] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const chatAbort = useRef<AbortController | null>(null);
  const voiceAbort = useRef<AbortController | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const lastAudioRef = useRef<{ text: string; blob: Blob; decoded?: AudioBuffer } | null>(null);
  const profileRef = useRef<SevenProfile | null>(null);
  const conversationId = useRef(loadSession());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    getSevenProfile().then((data) => { setProfile(data); profileRef.current = data; }).catch((cause) => setError(cause.message));
    getSevenModels().then((catalog) => {
      setModels(catalog);
      setSelectedModel((current) => {
        if (current && !catalog.some((model) => model.key === current && !model.local)) {
          const fallback = '';
          localStorage.setItem(MODEL_KEY, fallback || OPENCLAW_DEFAULT_CHOICE);
          return fallback;
        }
        return current;
      });
    }).catch((cause) => setError(cause.message));
    return () => {
      chatAbort.current?.abort(); voiceAbort.current?.abort();
      try { audioSourceRef.current?.stop(); } catch { /* already finished */ }
      void audioContextRef.current?.close();
      audioRef.current?.pause(); if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    };
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible' || status === 'thinking') return;
      getSevenProfile().then((data) => { setProfile(data); profileRef.current = data; }).catch(() => {});
    };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer); };
  }, [status]);


  useEffect(() => {
    const canvas = voiceCanvasRef.current;
    const analyser = audioAnalyserRef.current;
    if (status !== 'speaking' || !canvas || !analyser) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const spectrum = new Uint8Array(analyser.frequencyBinCount);
    const energyIn = (minimum: number, maximum: number) => {
      const binWidth = analyser.context.sampleRate / analyser.fftSize;
      const first = Math.max(1, Math.floor(minimum / binWidth));
      const last = Math.min(spectrum.length - 1, Math.ceil(maximum / binWidth));
      let total = 0;
      for (let bin = first; bin <= last; bin++) total += spectrum[bin];
      return total / ((last - first + 1) * 255);
    };
    let low = 0;
    let middle = 0;
    let high = 0;
    let frame = 0;
    let flickerPhase = 0;
    let previousFrame = performance.now();
    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, width, height);
      analyser.getByteFrequencyData(spectrum);

      low = low * 0.72 + energyIn(85, 450) * 0.28;
      middle = middle * 0.72 + energyIn(450, 2200) * 0.28;
      high = high * 0.72 + energyIn(2200, 6500) * 0.28;
      const now = performance.now();
      const fastFlicker = Math.floor(now / 1250) % 2 === 0;
      flickerPhase += Math.min(now - previousFrame, 100) * (fastFlicker ? 3.2 : .85) * Math.PI * 2 / 1000;
      previousFrame = now;
      const flicker = (Math.sin(flickerPhase) + 1) / 2;
      const voiceEnergy = Math.min(1, low + middle + high);
      canvas.style.opacity = String(.08 + flicker * (.025 + voiceEnergy * .015));
      const size = Math.min(width, height);
      context.translate(width / 2, height / 2);
      context.globalCompositeOperation = 'lighter';
      const glow = (x: number, y: number, radius: number, red: number, green: number, blue: number, strength: number) => {
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${strength})`);
        gradient.addColorStop(0.45, `rgba(${red}, ${green}, ${blue}, ${strength * 0.38})`);
        gradient.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
        context.fillStyle = gradient;
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      };
      const drift = Math.sin(performance.now() * 0.0012) * size * 0.035;
      glow(0, 0, size * (0.46 + low * 0.045), 195, 10, 32, 0.48 + low * 0.48);
      glow(-size * 0.13 + drift, size * 0.08, size * (0.37 + middle * 0.055), 255, 35, 53, 0.3 + middle * 0.7);
      glow(size * 0.15, -size * 0.1 - drift, size * (0.36 + high * 0.05), 255, 93, 105, 0.22 + high * 0.68);
      const time = performance.now() * 0.001;
      const bands = [low, middle, high];
      for (let plume = 0; plume < 7; plume++) {
        const energy = bands[plume % bands.length];
        const angle = plume * 2.4 + Math.sin(time * 0.41 + plume * 1.7) * 0.16;
        const reach = size * (0.2 + Math.sin(time * 0.67 + plume * 2.1) * 0.035);
        const x = Math.cos(angle) * reach;
        const y = Math.sin(angle) * reach;
        glow(x, y, size * (0.2 + energy * 0.075), 255, 31 + plume * 6, 45 + plume * 7, 0.17 + energy * 0.55);
      }
      frame = window.requestAnimationFrame(draw);
    };
    draw();
    return () => {
      window.cancelAnimationFrame(frame);
      canvas.style.opacity = '';
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [status]);


  const unlockAudio = () => {
    if (!window.AudioContext) return;
    try {
      const context = audioContextRef.current || new AudioContext();
      audioContextRef.current = context;
      void context.resume().catch(() => {});
      const silent = context.createBufferSource();
      silent.buffer = context.createBuffer(1, 1, context.sampleRate);
      silent.connect(context.destination);
      silent.start();
    } catch { /* text chat remains available if audio hardware is unavailable */ }
  };

  const stopVoice = () => {
    voiceAbort.current?.abort();
    voiceAbort.current = null;
    const source = audioSourceRef.current;
    audioSourceRef.current = null;
    try { source?.stop(); } catch { /* already finished */ }
    source?.disconnect();
    audioGainRef.current?.disconnect();
    audioGainRef.current = null;
    audioAnalyserRef.current?.disconnect();
    audioAnalyserRef.current = null;
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrl.current) { URL.revokeObjectURL(audioUrl.current); audioUrl.current = null; }
    setStatus('ready');
  };

  const playAnswer = async (text: string) => {
    const activeProfile = profileRef.current;
    if (!activeProfile?.voice_enabled || !text.trim()) return;
    const cached = lastAudioRef.current?.text === text ? lastAudioRef.current : null;
    stopVoice();
    setError('');
    setReplayReady(false);
    const controller = new AbortController();
    voiceAbort.current = controller;
    setStatus('preparing');
    let spokenBlob: Blob | null = null;
    try {
      const blob = cached?.blob ?? await speakSeven(text, controller.signal);
      spokenBlob = blob;
      if (controller.signal.aborted) return;
      lastAudioRef.current = { text, blob, decoded: cached?.decoded };
      if (window.AudioContext) {
        const context = audioContextRef.current || new AudioContext();
        audioContextRef.current = context;
        const decoded = cached?.decoded ?? await context.decodeAudioData(await blob.arrayBuffer());
        lastAudioRef.current.decoded = decoded;
        const resumed = await Promise.race([
          context.resume().then(() => true).catch(() => false),
          new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 2000)),
        ]);
        if (controller.signal.aborted) return;
        if (!resumed || context.state !== 'running') throw new Error('O navegador bloqueou a reprodução automática.');
        const source = context.createBufferSource();
        source.buffer = decoded;
        const gain = context.createGain();
        gain.gain.value = 1.8;
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.75;
        source.connect(gain);
        gain.connect(analyser);
        analyser.connect(context.destination);
        audioSourceRef.current = source;
        audioGainRef.current = gain;
        audioAnalyserRef.current = analyser;
        source.onended = () => {
          if (audioSourceRef.current === source) {
            audioSourceRef.current = null;
            source.disconnect();
            gain.disconnect();
            analyser.disconnect();
            audioGainRef.current = null;
            audioAnalyserRef.current = null;
            voiceAbort.current = null;
            setStatus('ready');
          }
        };
        source.start();
        setReplayReady(true);
        setStatus('speaking');
      } else {
        const replayUrl = URL.createObjectURL(blob);
        audioUrl.current = replayUrl;
        const audio = new Audio(replayUrl);
        audioRef.current = audio;
        audio.onended = stopVoice;
        audio.onerror = () => { setError('Não consegui reproduzir a voz. Use o botão de áudio para tentar novamente.'); stopVoice(); };
        await audio.play();
        setReplayReady(true);
        setStatus('speaking');
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        stopVoice();
        if (spokenBlob) {
          lastAudioRef.current = { text, blob: spokenBlob, decoded: lastAudioRef.current?.text === text ? lastAudioRef.current.decoded : undefined };
          setReplayReady(true);
          setError('A voz foi gerada, mas não começou a tocar. Clique em Ouvir novamente.');
        } else {
          setError(cause instanceof Error ? cause.message : 'Não consegui gerar a voz.');
        }
      }
    }
  };

  const submit = async () => {
    const text = draft.trim();
    const activeProfile = profileRef.current;
    if (!text || !activeProfile || status === 'thinking') return;
    unlockAudio();
    stopVoice(); setReplayReady(false); setError(''); setDraft('');
    const userMessage: ChatItem = { id: crypto.randomUUID(), role: 'user', text };
    const assistantMessage: ChatItem = { id: crypto.randomUUID(), role: 'assistant', text: '' };
    const next = [...messages, userMessage, assistantMessage];
    setMessages(next); saveChat(next);
    setStatus('thinking');
    const controller = new AbortController(); chatAbort.current = controller;
    const sessionId = conversationId.current;
    let accumulated = '';
    try {
      for await (const content of streamSevenChat({
        conversation_id: sessionId,
        text,
        ...(selectedModel ? { model: selectedModel } : {}),
        history: messages.filter((item) => item.text.trim()).slice(-8).map((item) => ({ role: item.role, text: item.text.slice(0, 4000) })),
      }, controller.signal)) {
        accumulated += content;
        if (!activeProfile.voice_enabled && conversationId.current === sessionId) {
          setMessages((current) => current.map((item) => item.id === assistantMessage.id ? { ...item, text: accumulated } : item));
        }
      }
      if (conversationId.current !== sessionId) return;
      const finalText = accumulated.trim() || 'Não consegui gerar uma resposta. Tente novamente.';
      const finalItems = next.map((item) => item.id === assistantMessage.id ? { ...item, text: finalText } : item);
      if (!controller.signal.aborted && activeProfile.voice_enabled) await playAnswer(finalText);
      setMessages(finalItems); saveChat(finalItems);
      if (!activeProfile.voice_enabled) setStatus('ready');
      getSevenProfile().then((data) => { setProfile(data); profileRef.current = data; }).catch(() => {});
    } catch (cause) {
      if (conversationId.current !== sessionId) return;
      if (controller.signal.aborted) {
        const finalItems = next.map((item) => item.id === assistantMessage.id ? { ...item, text: accumulated.trim() || 'Resposta interrompida.' } : item);
        setMessages(finalItems); saveChat(finalItems);
      } else {
        const detail = cause instanceof Error ? cause.message : 'A conexão com o OpenClaw foi interrompida.';
        setError(detail);
        const failureText = selectedModel && models.some((model) => model.key === selectedModel && model.local)
          ? 'A resposta do modelo local foi interrompida. Tente novamente ou escolha um modelo remoto.'
          : 'A resposta foi interrompida. Tente novamente.';
        const finalItems = next.map((item) => item.id === assistantMessage.id ? { ...item, text: accumulated.trim() || failureText } : item);
        setMessages(finalItems); saveChat(finalItems);
      }
      setStatus('ready');
    } finally { if (chatAbort.current === controller) chatAbort.current = null; }
  };

  const stop = () => {
    chatAbort.current?.abort(); stopVoice();
    if (status === 'thinking') setStatus('ready');
  };
  const remoteProviders = [...new Set(models.filter((model) => !model.local).map((model) => model.provider))];

  return <div className="seven-shell">
    <div className="seven-noise" aria-hidden="true" />
    <header className="seven-header">
      <Link to="/" className="seven-wordmark"><img src="/seven/7build-mark.svg" alt="" /><span>SEVEN</span><small>ASSISTENTE PESSOAL</small></Link>
      <div className="seven-header-right">
        <div className="seven-clock" aria-label="Horário local"><strong>{now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong><span>{now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}</span></div>
        <label className="seven-model" title="Modelos configurados no OpenClaw"><Cpu size={15} /><select aria-label="Modelo do OpenClaw" value={selectedModel} onChange={(event) => { const model = event.target.value; setSelectedModel(model); localStorage.setItem(MODEL_KEY, model || OPENCLAW_DEFAULT_CHOICE); }}><option value="">Padrão do OpenClaw (remoto)</option>{remoteProviders.map((provider) => <optgroup key={provider} label={`REMOTOS · ${provider === 'openai' ? 'OpenAI (API)' : provider.toUpperCase()}`}>{models.filter((model) => !model.local && model.provider === provider).map((model) => <option key={model.key} value={model.key}>{model.name}</option>)}</optgroup>)}</select></label>
        <Link to="/squads" className="seven-icon-link seven-squads-link" title="Squads"><Boxes size={18} /><span>Squads</span></Link>
        <Link to="/brain" className="seven-icon-link" title="Segundo cérebro" aria-label="Segundo cérebro"><BrainCircuit size={19} /></Link>
        <Link to="/seven/settings" className="seven-icon-link" title="Voz e painel"><Settings2 size={19} /></Link>
      </div>
    </header>

    <main className="seven-main seven-main-minimal">
      <section className="seven-conversation seven-conversation-minimal" aria-label="Conversa com Seven">
        <div className="seven-avatar-wrap">
          <div className={`seven-orb-stage seven-orb-stage-${status}`}>
            <SevenBrainBackdrop notes={profile?.notes ?? []} />
            <canvas ref={voiceCanvasRef} className="seven-orb-voice" aria-hidden="true" />
            <div ref={orbRef} className={`seven-orb seven-orb-${status}`} role="img" aria-label={`Estado do Seven: ${status === 'ready' ? 'pronto' : status === 'thinking' || status === 'preparing' ? 'processando' : 'falando'}`}>
              <svg className="seven-orb-filter" aria-hidden="true" focusable="false">
                <defs>
                  <filter id="seven-orb-red-cutout" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
                    <feColorMatrix in="SourceGraphic" type="saturate" values="0" result="gray" />
                    <feComponentTransfer in="gray" result="red-palette">
                      <feFuncR type="linear" slope="2" />
                      <feFuncG type="linear" slope="2.1" intercept="-1" />
                      <feFuncB type="linear" slope="2.3" intercept="-1.2" />
                    </feComponentTransfer>
                    <feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="light" />
                    <feComponentTransfer in="light" result="visible-light">
                      <feFuncA type="linear" slope="4.4" intercept="-0.65" />
                    </feComponentTransfer>
                    <feComposite in="red-palette" in2="visible-light" operator="in" />
                  </filter>
                </defs>
              </svg>
              <span className="seven-orb-art seven-orb-art-rest" aria-hidden="true" />
              <span className="seven-orb-art seven-orb-band" aria-hidden="true" />
              <span className="seven-orb-art seven-orb-clock-ticks" aria-hidden="true" />
              <span className="seven-orb-art seven-orb-outer-half seven-orb-outer-half-a" aria-hidden="true" />
              <span className="seven-orb-art seven-orb-outer-half seven-orb-outer-half-b" aria-hidden="true" />
            </div>
          </div>
        </div>
        <form className="seven-composer seven-composer-minimal" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder={error || "Escreva para o Seven..."} rows={2} aria-label="Mensagem para o Seven" aria-invalid={!!error} />
          <div className="seven-composer-bottom seven-composer-actions">
            <span className="seven-visually-hidden" role="status">{status === 'thinking' || status === 'preparing' ? 'Processando' : status === 'speaking' ? 'Falando' : ''}</span>
            <div>{status !== 'ready' && <button type="button" className="seven-stop" onClick={stop} title="Parar" aria-label="Parar"><CircleStop size={19} /></button>}<button type="submit" className="seven-send" disabled={!draft.trim() || status === 'thinking' || !profile} title="Enviar" aria-label="Enviar"><ArrowUp size={19} /></button></div>
          </div>
        </form>
        <span className="seven-visually-hidden" role="alert">{error}</span>
      </section>
    </main>
  </div>;
}
