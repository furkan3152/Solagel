import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { SiteSession } from '../storedSession';
import { PlayGate } from './PlayGate';

/** The game's chunks, requested once (as soon as the gate opens, while its barrier swings up). */
let game: Promise<[typeof import('../../app-entry'), typeof import('../../store')]> | null = null;
const loadGame = () => (game ??= Promise.all([import('../../app-entry'), import('../../store')]));

/** Loads the game (lobby, engine, wallet flow) into `root`, signed in as `session` when given. */
async function launchGame(root: HTMLElement, session: SiteSession | null): Promise<void> {
  const [{ mount }, { useUi }] = await loadGame();
  // the engine sends this token on `welcome`, before its first room entry (the gate checks the session)
  if (session && !useUi.getState().auth) useUi.setState({ auth: { address: session.address, token: session.token, profile: null } });
  mount(root);
}

/** `/play`: the arena, behind the game gate. */
export function startPlay(root: HTMLElement): void {
  document.title = 'Elymum · Arena';
  // the arena handles its own pinch and drag: no page zoom there (the site pages keep zoom)
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  // the static boot loader from index.html (the other entries replace it by rendering into root)
  root.querySelector(':scope > .boot')?.remove();
  const holder = document.createElement('div');
  root.appendChild(holder);
  const gate = createRoot(holder);
  gate.render(
    <StrictMode>
      <PlayGate
        onOpening={() => void loadGame().catch(() => (game = null))}
        onAllowed={(session) => {
          setTimeout(() => {
            gate.unmount();
            holder.remove();
            void launchGame(root, session);
          }, 0);
        }}
      />
    </StrictMode>,
  );
}
