import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
import {
  getSevenAgentSettings, getSevenModels, removeSevenProviderKey,
  saveSevenAgentModels, saveSevenProviderKey,
  type SevenAgentSettings as AgentSettings, type SevenModel,
} from '../lib/seven';
import './SevenAgentSettings.css';

export function SevenAgentSettings() {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [models, setModels] = useState<SevenModel[]>([]);
  const [primary, setPrimary] = useState('');
  const [fallbacks, setFallbacks] = useState<string[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const [agent, catalog] = await Promise.all([getSevenAgentSettings(), getSevenModels()]);
    setSettings(agent);
    setModels(catalog);
    setPrimary(agent.default_model);
    setFallbacks(agent.fallbacks);
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o OpenClaw.'))
      .finally(() => setLoading(false));
  }, [refresh]);

  const saveKey = async (provider: string) => {
    const value = keys[provider]?.trim();
    if (!value) return;
    setBusy(provider); setError(''); setNotice('');
    try {
      await saveSevenProviderKey(provider, value);
      setKeys((current) => ({ ...current, [provider]: '' }));
      await refresh();
      setNotice('Chave salva no OpenClaw. Os modelos desse provedor já podem aparecer na lista.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a chave.'); }
    finally { setBusy(''); }
  };

  const removeKey = async (provider: string) => {
    setBusy(provider); setError(''); setNotice('');
    try {
      await removeSevenProviderKey(provider);
      await refresh();
      setNotice('Chave removida do OpenClaw.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível remover a chave.'); }
    finally { setBusy(''); }
  };

  const saveModels = async () => {
    setBusy('models'); setError(''); setNotice('');
    try {
      await saveSevenAgentModels(primary, fallbacks);
      await refresh();
      setNotice('Modelo padrão e fallbacks salvos no OpenClaw.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar os modelos.'); }
    finally { setBusy(''); }
  };

  const local = models.filter((model) => model.local);
  const remoteProviders = [...new Set(models.filter((model) => !model.local).map((model) => model.provider))];
  const options = () => <>
    {local.length > 0 && <optgroup label="LOCAIS · VPS">{local.map((model) => <option key={model.key} value={model.key}>{model.name}</option>)}</optgroup>}
    {remoteProviders.map((provider) => <optgroup key={provider} label={`REMOTOS · ${provider === 'openai' ? 'OpenAI (API)' : provider.toUpperCase()}`}>
      {models.filter((model) => !model.local && model.provider === provider).map((model) => <option key={model.key} value={model.key}>{model.name}</option>)}
    </optgroup>)}
  </>;

  return <section className="seven-agent-settings" aria-label="Agente e modelos do OpenClaw">
    <div className="seven-agent-settings-heading"><div><span>AGENTE · OPENCLAW</span><h3>Modelos e chaves de API</h3><p>O Seven usa o agente que roda na VPS. As chaves ficam no OpenClaw e o valor salvo nunca é exibido aqui.</p></div></div>
    {loading ? <p className="seven-agent-settings-muted"><LoaderCircle size={15} className="seven-agent-spin" /> Carregando configuração...</p> : !settings ? <p className="seven-agent-settings-error">{error || 'Configuração indisponível.'}</p> : <>
      <div className="seven-agent-settings-section">
        <h4><KeyRound size={16} /> Provedores remotos</h4>
        <div className="seven-agent-providers">{settings.providers.map((provider) => <div className="seven-agent-provider" key={provider.id}>
          <div className="seven-agent-provider-top"><strong>{provider.label}</strong><span className={provider.configured ? 'connected' : ''}>{provider.configured ? 'Chave salva' : 'Sem chave'}</span></div>
          {provider.source === 'external' ? <p>Credencial gerenciada fora deste painel.</p> : <>
            <div className="seven-agent-key-row"><input type="password" autoComplete="off" spellCheck={false} value={keys[provider.id] || ''} onChange={(event) => setKeys((current) => ({ ...current, [provider.id]: event.target.value }))} placeholder={provider.configured ? 'Nova chave para substituir a atual' : 'Cole a chave de API'} aria-label={`Chave de API ${provider.label}`} /><button type="button" disabled={!!busy || !keys[provider.id]?.trim()} onClick={() => void saveKey(provider.id)}>{busy === provider.id ? <LoaderCircle size={14} className="seven-agent-spin" /> : <Save size={14} />}{provider.configured ? 'Trocar' : 'Conectar'}</button></div>
            {provider.source === 'panel' && <button className="seven-agent-remove" type="button" disabled={!!busy || !provider.can_remove} onClick={() => void removeKey(provider.id)} title={provider.can_remove ? 'Remover chave' : 'Escolha outro modelo padrão e remova os fallbacks deste provedor antes de apagar a chave'}><Trash2 size={13} /> Remover chave</button>}
          </>}
        </div>)}</div>
      </div>
      <div className="seven-agent-settings-section">
        <h4>Modelo padrão</h4><p className="seven-agent-settings-muted">Vale para novas conversas do Seven. O seletor no chat muda apenas a conversa atual.</p>
        <label className="seven-agent-model-label">Principal<select value={primary} onChange={(event) => setPrimary(event.target.value)}>{options()}</select></label>
        <div className="seven-agent-fallback-head"><strong>Fallbacks</strong><button type="button" disabled={!!busy || fallbacks.length >= 3} onClick={() => setFallbacks((current) => [...current, ''])}><Plus size={13} /> Adicionar</button></div>
        {fallbacks.length === 0 && <p className="seven-agent-settings-muted">Nenhum modelo reserva.</p>}
        {fallbacks.map((model, index) => <div className="seven-agent-fallback" key={index}><select aria-label={`Fallback ${index + 1}`} value={model} onChange={(event) => setFallbacks((current) => current.map((value, position) => position === index ? event.target.value : value))}><option value="">Selecione um modelo</option>{options()}</select><button type="button" aria-label={`Remover fallback ${index + 1}`} onClick={() => setFallbacks((current) => current.filter((_, position) => position !== index))}><Trash2 size={14} /></button></div>)}
        <button className="seven-agent-save-models" type="button" disabled={!!busy || !primary || fallbacks.some((model) => !model)} onClick={() => void saveModels()}>{busy === 'models' ? <LoaderCircle size={14} className="seven-agent-spin" /> : <Save size={14} />} Salvar modelos</button>
      </div>
      {(notice || error) && <p role="status" className={error ? 'seven-agent-settings-error' : 'seven-agent-settings-success'}>{error || notice}</p>}
    </>}
  </section>;
}
