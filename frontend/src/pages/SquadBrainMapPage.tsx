import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { SquadBrainMap } from '../components/SquadBrainMap';
import { getSquadBrain, type SquadBrainNote } from '../lib/squads';
import './SquadBrainMapPage.css';

export function SquadBrainMapPage() {
  const { squadId } = useParams();
  const [notes, setNotes] = useState<SquadBrainNote[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!squadId) return;
    let active = true;
    const load = async () => {
      try { const result = await getSquadBrain(squadId); if (active) { setNotes(result); setError(''); } }
      catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o mapa.'); }
      finally { if (active) setLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [squadId]);

  return <main className="squad-brain-map-page">
    <SquadBrainMap notes={notes} />
    <Link to={`/squads/${squadId}`} className="squad-brain-map-back" aria-label="Voltar à squad"><ArrowLeft size={18} /></Link>
    {loading && <div className="squad-brain-map-status">Carregando cérebro...</div>}
    {error && <div className="squad-brain-map-status" role="alert">{error}</div>}
  </main>;
}
