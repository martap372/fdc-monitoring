import { useState } from 'react';
import './App.css'
import Calendar from './components/Calendar'
import AF from './components/AF'
import Planos from './components/Planos'
import PTs from './components/PTs'
import Vencimento from './components/Vencimento'

function App() {
  const [view, setView] = useState('pts');

  return (
    <>
      <nav className="app-navigation" aria-label="Secções">
        <button className={view === 'pts' ? 'active' : ''} type="button" onClick={() => setView('pts')}>Treinos PT</button>
        <button className={view === 'af' ? 'active' : ''} type="button" onClick={() => setView('af')}>Avaliações Físicas</button>
        <button className={view === 'planos' ? 'active' : ''} type="button" onClick={() => setView('planos')}>Planos de Treino</button>
        <button className={view === 'calendar' ? 'active' : ''} type="button" onClick={() => setView('calendar')}>Mapa de Sala</button>
        <button className={view === 'vencimento' ? 'active' : ''} type="button" onClick={() => setView('vencimento')}>Vencimento Técnico</button>
      </nav>
      {view === 'pts' ? <PTs/> : view === 'af' ? <AF/> : view === 'planos' ? <Planos/> : view === 'calendar' ? <Calendar/> : <Vencimento/>}
    </>
  );
}

export default App;
