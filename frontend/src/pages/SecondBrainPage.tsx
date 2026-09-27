import { Link } from 'react-router';
import { BrainCircuit, MessageSquare, NotebookPen, Settings2 } from 'lucide-react';
import { SevenSettings } from '../components/SevenSettings';
import './SecondBrainPage.css';

export function SecondBrainPage({ view = 'map' }: { view?: 'map' | 'notes' }) {
  if (view === 'map') return <SevenSettings mode="brain" />;

  return <div className="seven-brain-page">
    <header className="seven-brain-page-header">
      <Link to="/" className="seven-brain-brand"><img src="/seven/7build-mark.svg" alt="" /><strong>SEVEN</strong><small>SEGUNDO CÉREBRO</small></Link>
      <nav aria-label="Navegação do Segundo Cérebro">
        <Link to="/" title="Conversa"><MessageSquare size={16} /> <span>Conversa</span></Link>
        <Link to="/brain"><BrainCircuit size={16} /> <span>Mapa</span></Link>
        <Link to="/brain/notes" className="active" aria-current="page"><NotebookPen size={16} /> <span>Notas</span></Link>
        <Link to="/settings" title="Configurações"><Settings2 size={16} /> <span>Configurações</span></Link>
      </nav>
    </header>
    <main className="seven-brain-page-main"><SevenSettings mode="notes" /></main>
  </div>;
}
