import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowUp, BrainCircuit, Boxes, ChevronRight, CircleStop, Cpu, LoaderCircle, Settings2, Volume2, X, NotebookPen, AudioLines, Clock3 } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { streamChat } from '../lib/sse';
import {
  getSevenProfile, rememberSevenTurn, sevenIsIdentityQuestion, sevenRequestsFamilyGoal, sevenSystemPrompt,
  speakSeven, stripAndCollectMemories, sevenVoiceGender,
  type SevenProfile,
} from '../lib/seven';
import './SevenPage.css';
import { useSevenOrbMotion } from './useSevenOrbMotion';

type ChatItem = { id: string; role: 'user' | 'assistant'; text: string };
const CHAT_KEY = 'seven-chat-v1';
const obsoleteTopicRefusal = /n[aã]o tenho interesse em legos?|n[aã]o em outros t[oó]picos pessoais|meu foco [eé] auxiliar na gest[aã]o do dia a dia da empresa/i;

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
  const selectedModel = useAppStore((s) => s.selectedModel);
  const serverInfo = useAppStore((s) => s.serverInfo);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const settings = useAppStore((s) => s.settings);
  const [profile, setProfile] = useState<SevenProfile | null>(null);
  const [messages, setMessages] = useState<ChatItem[]>(loadChat);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'ready' | 'thinking' | 'preparing' | 'speaking'>('ready');
  const orbRef = useSevenOrbMotion(status);
  const [error, setError] = useState('');
  const [brainSync, setBrainSync] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [replayReady, setReplayReady] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatAbort = useRef<AbortController | null>(null);
  const voiceAbort = useRef<AbortController | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const lastAudioRef = useRef<{ text: string; blob: Blob; decoded?: AudioBuffer } | null>(null);
  const profileRef = useRef<SevenProfile | null>(null);
  const memoryTurnRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    getSevenProfile().then((data) => { setProfile(data); profileRef.current = data; }).catch((cause) => setError(cause.message));
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
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, status]);

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
        source.connect(gain);
        gain.connect(context.destination);
        audioSourceRef.current = source;
        audioGainRef.current = gain;
        source.onended = () => {
          if (audioSourceRef.current === source) {
            audioSourceRef.current = null;
            source.disconnect();
            gain.disconnect();
            audioGainRef.current = null;
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
    memoryTurnRef.current = userMessage.id;
    const assistantMessage: ChatItem = { id: crypto.randomUUID(), role: 'assistant', text: '' };
    const next = [...messages, userMessage, assistantMessage];
    setMessages(next); saveChat(next);
    setStatus('thinking');
    const controller = new AbortController(); chatAbort.current = controller;
    let accumulated = '';
    setBrainSync('saving');
    const saveMemory = async (answer: string) => {
      try {
        await rememberSevenTurn({ turn_id: userMessage.id, user_text: text, assistant_text: answer });
        const refreshed = await getSevenProfile();
        setProfile(refreshed); profileRef.current = refreshed;
        if (memoryTurnRef.current === userMessage.id) setBrainSync('saved');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Não consegui atualizar as notas do Segundo Cérebro.');
        if (memoryTurnRef.current === userMessage.id) setBrainSync('error');
      }
    };
    try {
      const history = (sevenIsIdentityQuestion(text) ? [userMessage] : [...messages.slice(-16), userMessage])
        .filter((item) => (sevenRequestsFamilyGoal(text) || !sevenRequestsFamilyGoal(item.text)) && (item.role !== 'assistant' || !obsoleteTopicRefusal.test(item.text)))
        .map((item) => ({ role: item.role, content: item.text }));
      for await (const event of streamChat({
        model: selectedModel || serverInfo?.model || 'default',
        messages: [{ role: 'system', content: sevenSystemPrompt(activeProfile, text) }, ...history],
        stream: true, direct: true, temperature: settings.temperature, max_tokens: settings.maxTokens,
      }, controller.signal)) {
        try {
          const chunk = JSON.parse(event.data);
          const content = chunk.choices?.[0]?.delta?.content;
          if (typeof content === 'string') {
            accumulated += content;
            const visible = accumulated.replace(/\[\[SAVE:[\s\S]*$/m, '').trim();
            if (!activeProfile.voice_enabled) setMessages((current) => current.map((item) => item.id === assistantMessage.id ? { ...item, text: visible } : item));
          }
        } catch { /* non-chat event */ }
      }
      const { clean } = stripAndCollectMemories(accumulated);
      const finalText = clean || 'Não consegui gerar uma resposta. Tente novamente.';
      if (finalText.includes('Error during generation:') || finalText.startsWith('Sorry, an error occurred:')) {
        throw new Error(finalText.replace(/^.*?(Error during generation:|Sorry, an error occurred:)/s, '$1').trim());
      }
      const finalItems = next.map((item) => item.id === assistantMessage.id ? { ...item, text: finalText } : item);
      if (!controller.signal.aborted && activeProfile.voice_enabled) await playAnswer(finalText);
      setMessages(finalItems); saveChat(finalItems);
      if (!activeProfile.voice_enabled) setStatus('ready');
      if (chatAbort.current === controller) chatAbort.current = null;
      await saveMemory(finalText);
    } catch (cause) {
      if (controller.signal.aborted) {
        const finalItems = next.map((item) => item.id === assistantMessage.id ? { ...item, text: accumulated.trim() || 'Resposta interrompida.' } : item);
        setMessages(finalItems); saveChat(finalItems);
      } else {
        const reason = cause instanceof Error ? cause.message : 'Erro ao consultar o modelo.';
        setError(reason);
        const finalItems = next.map((item) => item.id === assistantMessage.id ? { ...item, text: 'Não consegui responder agora. Verifique se o OpenJarvis e o modelo estão ativos.' } : item);
        setMessages(finalItems); saveChat(finalItems);
      }
      setStatus('ready');
      await saveMemory('');
    } finally { if (chatAbort.current === controller) chatAbort.current = null; }
  };

  const stop = () => {
    chatAbort.current?.abort(); stopVoice();
    if (status === 'thinking') setStatus('ready');
  };
  const readyLabel = sevenVoiceGender(profile?.voice_id || '') === 'masculine' ? 'Pronto' : 'Pronta';
  const stateLabel = status === 'thinking' ? 'PROCESSANDO' : status === 'preparing' ? 'PREPARANDO VOZ' : status === 'speaking' ? 'FALANDO' : readyLabel.toUpperCase();
  const lastAnswer = [...messages].reverse().find((item) => item.role === 'assistant' && item.text)?.text;

  return <div className="seven-shell">
    <div className="seven-noise" aria-hidden="true" />
    <header className="seven-header">
      <Link to="/" className="seven-wordmark"><img src="/seven/7build-mark.svg" alt="" /><span>SEVEN</span><small>ASSISTENTE PESSOAL</small></Link>
      <div className="seven-header-right">
        <div className="seven-clock" aria-label="Horário local"><strong>{now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong><span>{now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}</span></div>
        <button type="button" className="seven-model" onClick={() => setCommandPaletteOpen(true)} title="Trocar modelo"><Cpu size={15} /> {selectedModel || serverInfo?.model || 'Selecionar modelo'} <ChevronRight size={14} /></button>
        <Link to="/squads" className="seven-icon-link seven-squads-link" title="Squads"><Boxes size={18} /><span>Squads</span></Link>
        <Link to="/brain" className="seven-icon-link" title="Segundo cérebro" aria-label="Segundo cérebro"><BrainCircuit size={19} /></Link>
        <Link to="/settings" className="seven-icon-link" title="Configurações"><Settings2 size={19} /></Link>
      </div>
    </header>

    <main className="seven-main">
      <aside className="seven-hud seven-hud-left" aria-label="Estado do sistema">
        <div className="seven-hud-card"><span className="seven-hud-heading">SISTEMA</span><div className="seven-hud-row"><span><i className="seven-state-dot" /> Seven</span><strong>{stateLabel.toLowerCase()}</strong></div><div className="seven-hud-row"><span><Cpu size={13} /> Modelo</span><strong>{selectedModel || serverInfo?.model || 'Padrão'}</strong></div><div className="seven-hud-row"><span><AudioLines size={13} /> Voz</span><strong>{profile?.voice_enabled ? 'Ativada' : 'Desativada'}</strong></div></div>
        <div className="seven-hud-card"><span className="seven-hud-heading">CONTEXTO</span><p>Suas notas ficam no Segundo Cérebro e podem ser editadas a qualquer momento.</p><Link to="/brain/notes"><NotebookPen size={14} /> {profile?.notes.length ?? 0} notas <ChevronRight size={13} /></Link></div>
      </aside>
      <section className="seven-conversation" aria-label="Conversa com Seven">
        <div className="seven-intro">
          <div ref={orbRef} className={`seven-orb seven-orb-${status}`} role="img" aria-label={`Estado do Seven: ${stateLabel.toLowerCase()}`}>
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
          <p className="seven-eyebrow">SEVEN · ASSISTENTE DA 7BUILD</p>
          <h1>{messages.length ? stateLabel : <>À disposição, <em>{profile?.address || 'senhor'}.</em></>}</h1>
          <p>{messages.length ? 'Sua conversa continua abaixo.' : 'Escreva sua mensagem. O Seven responde com o contexto que você escolher.'}</p>
        </div>
        <div className="seven-messages" ref={scrollRef}>
          {messages.length === 0 && <div className="seven-empty"><span className="seven-empty-line" />{readyLabel} para a primeira conversa.</div>}
          {messages.map((item) => <article key={item.id} className={`seven-message seven-message-${item.role}`}>
            <div className="seven-message-avatar">{item.role === 'assistant' ? <img src="/seven/7build-mark.svg" alt="" /> : 'M'}</div>
            <div className="seven-message-body"><div className="seven-message-meta">{item.role === 'assistant' ? (profile?.name || 'Seven') : 'Matheus'}{item.role === 'assistant' && item.text && <button type="button" onClick={() => { unlockAudio(); void playAnswer(item.text); }} title="Ouvir resposta"><Volume2 size={14} /></button>}</div><p>{item.text || <span className="seven-dots">Aguarde<span>.</span><span>.</span><span>.</span></span>}</p></div>
          </article>)}
        </div>
        {error && <div className="seven-error" role="alert">{error}<button type="button" onClick={() => setError('')}><X size={14} /></button></div>}
        {replayReady && lastAudioRef.current && <div className="seven-audio-fallback"><button type="button" onClick={() => { unlockAudio(); void playAnswer(lastAudioRef.current!.text); }}><Volume2 size={15} /> Ouvir novamente</button></div>}
        <form className="seven-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder="Escreva para o Seven..." rows={2} aria-label="Mensagem para o Seven" />
          <div className="seven-composer-bottom"><span>{status === 'thinking' ? <><LoaderCircle size={13} className="seven-spin" /> Processando</> : status === 'preparing' ? <><LoaderCircle size={13} className="seven-spin" /> Preparando voz</> : status === 'speaking' ? <><Volume2 size={13} /> Falando</> : <><span className="seven-online-dot" /> {readyLabel} · entrada por texto</>}</span><div>{status !== 'ready' && <button type="button" className="seven-stop" onClick={stop} title="Parar"><CircleStop size={19} /></button>}<button type="submit" className="seven-send" disabled={!draft.trim() || status === 'thinking' || !profile} title="Enviar"><ArrowUp size={19} /></button></div></div>
        </form>
        <div className="seven-composer-hint">Enter envia · Shift + Enter quebra linha · <button type="button" onClick={() => { const empty: ChatItem[] = []; setMessages(empty); saveChat(empty); stop(); }}>Limpar conversa</button>{brainSync !== 'idle' && <> · <span role="status">{brainSync === 'saving' ? 'Salvando no Segundo Cérebro...' : brainSync === 'saved' ? 'Segundo Cérebro atualizado' : 'Falha ao salvar no Segundo Cérebro'}</span></>}</div>
      </section>
      <aside className="seven-hud seven-hud-right" aria-label="Atividade recente"><div className="seven-hud-card"><span className="seven-hud-heading">ATIVIDADE</span><div className="seven-hud-row"><span><Clock3 size={13} /> Última resposta</span><strong>{lastAnswer ? 'Disponível' : 'Aguardando'}</strong></div><p>{lastAnswer ? `${lastAnswer.slice(0, 180)}${lastAnswer.length > 180 ? '…' : ''}` : 'A conversa começa quando o senhor enviar uma mensagem.'}</p></div><div className="seven-hud-foot">ENTRADA POR TEXTO <span>·</span> RESPOSTA POR VOZ {profile?.voice_enabled ? 'ATIVA' : 'DESATIVADA'}</div></aside>
    </main>
  </div>;
}
